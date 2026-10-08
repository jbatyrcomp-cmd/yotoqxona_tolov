/**
 * ============================================================================
 * TALABALAR YOTOQXONASI TO'LOV TIZIMI - GOOGLE APPS SCRIPT BACKEND
 * ============================================================================
 * Muallif: Full-Stack Engineer
 * Maqsad: 6 000 nafargacha talabaning to'lov kvitansiyalarini qabul qilish,
 *         Google Drive papkasiga chek rasmini yuklash va Google Sheets
 *         jadvalini avtomatik yangilash.
 * ============================================================================
 */

// ======================= KONFIGURATSIYA SOZLAMALARI =======================
// Agar skript Google Sheets ichidan ochilgan bo'lsa (Extensions -> Apps Script),
// SPREADSHEET_ID bo'sh qolishi mumkin. Aks holda jadval ID sini kiriting.
const CONFIG = {
  SPREADSHEET_ID: "", // Bo'sh bo'lsa joriy jadval olinadi (SpreadsheetApp.getActiveSpreadsheet())
  DRIVE_FOLDER_ID: "1s7z9n2Pshs-sfr4q04Sf2PIW0pViG4Zg", // Cheklar saqlanadigan Google Drive papka ID si
  STUDENTS_SHEET_NAME: "Talabalar", // Asosiy talabalar ro'yxati varag'i
  PAYMENTS_SHEET_NAME: "To'lovlar", // To'lovlar tarixi / arxivi varag'i
  PAYMENT_STATUS_ON_SUBMIT: "Tekshiruvda", // Chek yuklangandagi holat: "Tekshiruvda" yoki "To'landi"
  TIMEZONE: "Asia/Tashkent"
};

/**
 * Faol Google Jadval obyektini olish
 */
function getSpreadsheet() {
  if (CONFIG.SPREADSHEET_ID && CONFIG.SPREADSHEET_ID.trim() !== "") {
    return SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID.trim());
  }
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) return active;
  throw new Error("Google Spreadsheet topilmadi. CONFIG.SPREADSHEET_ID ni tekshiring.");
}

/**
 * Cheklar saqlanadigan Google Drive papkasini olish
 */
function getReceiptsFolder() {
  if (!CONFIG.DRIVE_FOLDER_ID || CONFIG.DRIVE_FOLDER_ID === "YOUR_DRIVE_FOLDER_ID_HERE") {
    // Agar folder ID ko'rsatilmagan bo'lsa, Drive da avtomatik "Yotoqxona To'lov Cheklari" papkasini qidiradi yoki yaratadi
    const folderName = "Yotoqxona To'lov Cheklari";
    const folders = DriveApp.getFoldersByName(folderName);
    if (folders.hasNext()) {
      return folders.next();
    } else {
      return DriveApp.createFolder(folderName);
    }
  }
  return DriveApp.getFolderById(CONFIG.DRIVE_FOLDER_ID.trim());
}

/**
 * HTTP GET so'rovlarini qabul qilish
 * Frontend ga barcha talabalar ro'yxatini tezkor JSON formatida uzatadi
 */
function doGet(e) {
  try {
    const action = (e && e.parameter && e.parameter.action) ? e.parameter.action : "getStudents";

    if (action === "ping") {
      return createJsonResponse({ status: "ok", timestamp: new Date().toISOString() });
    }

    if (action === "getStudents") {
      const students = getAllStudents();
      return createJsonResponse({
        success: true,
        count: students.length,
        students: students
      });
    }

    return createJsonResponse({ success: false, error: "Noma'lum harakat (action)" });
  } catch (err) {
    Logger.log("doGet xatolik: " + err.toString());
    return createJsonResponse({ success: false, error: err.toString() });
  }
}

/**
 * HTTP POST so'rovlarini qabul qilish
 * Talabaning to'lov cheki va ma'lumotlarini qabul qilib Drive va Jadvalga saqlaydi
 */
function doPost(e) {
  // Parallel so'rovlarda ma'lumotlar ustma-ust tushmasligi uchun LockService qo'llaniladi
  const lock = LockService.getScriptLock();
  const hasLock = lock.tryLock(30000); // 30 soniya kutish

  if (!hasLock) {
    return createJsonResponse({
      success: false,
      error: "Tizim ayni daqiqada band. Iltimos, 5 soniyadan keyin qayta urinib ko'ring."
    });
  }

  try {
    if (!e || !e.postData || !e.postData.contents) {
      throw new Error("Yuborilgan ma'lumotlar bo'sh!");
    }

    let payload;
    try {
      payload = JSON.parse(e.postData.contents);
    } catch (parseErr) {
      throw new Error("JSON formati noto'g'ri: " + parseErr.message);
    }

    const {
      studentId,
      amount,
      imageBase64,
      mimeType = "image/jpeg",
      fileName = "chek.jpg",
      telegramUser = {}
    } = payload;

    // 1. Majburiy maydonlarni tekshirish (Validatsiya)
    if (!studentId || !studentId.toString().trim()) {
      throw new Error("Talaba ID si ko'rsatilmagan.");
    }
    if (!amount || isNaN(amount) || Number(amount) <= 0) {
      throw new Error("To'lov summasi musbat son bo'lishi kerak.");
    }
    if (!imageBase64 || imageBase64.length < 50) {
      throw new Error("Kvitansiya rasmi yuklanmagan yoki yaroqsiz.");
    }

    // 2. Talaba ma'lumotlarini bazadan topish
    const ss = getSpreadsheet();
    const studentsSheet = ss.getSheetByName(CONFIG.STUDENTS_SHEET_NAME);
    if (!studentsSheet) {
      throw new Error(`'${CONFIG.STUDENTS_SHEET_NAME}' varag'i topilmadi.`);
    }

    const data = studentsSheet.getDataRange().getValues();
    if (data.length <= 1) {
      throw new Error("Talabalar ro'yxati bo'sh.");
    }

    // Sarlavha ustunlari indekslarini aniqlash
    const headers = data[0].map(h => String(h).trim().toLowerCase());
    const colId = findColumnIndex(headers, ["id", "talaba id", "student id"]);
    const colName = findColumnIndex(headers, ["f.i.sh.", "f.i.sh", "fish", "ism", "familiya"]);
    const colFaculty = findColumnIndex(headers, ["fakultet", "faculty"]);
    const colGroup = findColumnIndex(headers, ["guruh", "yo'nalish va guruh", "group"]);
    const colDorm = findColumnIndex(headers, ["yotoqxona", "yotoqxona raqami", "ttj"]);
    const colRoom = findColumnIndex(headers, ["xona", "xona raqami", "room"]);
    const colStatus = findColumnIndex(headers, ["holat", "to'lov holati", "status"]);
    const colTotalFee = findColumnIndex(headers, ["jami to'lov", "jami qarzdorlik", "belgilangan to'lov", "shartnoma", "jami"]);
    const colAmount = findColumnIndex(headers, ["summa", "to'langan summa", "to'langan", "amount"]);
    const colDebt = findColumnIndex(headers, ["qarzdorlik", "qoldiq qarz", "qoldiq qarzdorlik", "qoldiq", "qarz", "debt"]);
    const colReceipt = findColumnIndex(headers, ["kvitansiya", "kvitansiya havolasi", "chek", "receipt"]);
    const colDate = findColumnIndex(headers, ["sana vaqti", "sana", "to'lov sanasi", "date"]);
    const colTg = findColumnIndex(headers, ["telegram foydalanuvchi", "telegram", "tg user"]);

    if (colId === -1) {
      throw new Error("Jadvalda 'ID' ustuni topilmadi.");
    }

    // Talabani ID bo'yicha qidirish
    let studentRowIndex = -1;
    let studentRowData = null;
    const targetId = String(studentId).trim().toLowerCase();

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][colId]).trim().toLowerCase() === targetId) {
        studentRowIndex = i + 1; // 1-indexed Sheets qator raqami
        studentRowData = data[i];
        break;
      }
    }

    if (studentRowIndex === -1) {
      throw new Error(`ID: ${studentId} bo'yicha talaba topilmadi.`);
    }

    const studentFullName = colName !== -1 ? String(studentRowData[colName]) : "Talaba";
    const studentFaculty = colFaculty !== -1 ? String(studentRowData[colFaculty]) : "";
    const studentGroup = colGroup !== -1 ? String(studentRowData[colGroup]) : "";

    // 3. Rasmni Google Drive ga saqlash
    const receiptsFolder = getReceiptsFolder();
    const cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, "");
    const decodedBytes = Utilities.base64Decode(cleanBase64);

    const now = new Date();
    const formattedDate = Utilities.formatDate(now, CONFIG.TIMEZONE, "yyyy-MM-dd_HH-mm-ss");
    const displayDate = Utilities.formatDate(now, CONFIG.TIMEZONE, "yyyy-MM-dd HH:mm:ss");

    // Fayl kengaytmasini aniqlash
    let ext = "jpg";
    if (mimeType.includes("png")) ext = "png";
    else if (mimeType.includes("webp")) ext = "webp";
    else if (mimeType.includes("pdf")) ext = "pdf";

    // Xavfsiz fayl nomi: [ID]_[F.I.Sh]_[Sana].jpg
    const safeName = studentFullName.replace(/[^a-zA-Z0-9_\u0400-\u04FF]/g, "_").substring(0, 30);
    const finalFileName = `Chek_${studentId}_${safeName}_${formattedDate}.${ext}`;

    const blob = Utilities.newBlob(decodedBytes, mimeType, finalFileName);
    const driveFile = receiptsFolder.createFile(blob);

    // Faylga havola orqali ko'rish huquqini berish
    try {
      driveFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (shareErr) {
      Logger.log("Sharing ruxsati berishda ogohlantirish: " + shareErr.message);
    }

    const receiptUrl = driveFile.getUrl();

    // 4. "Talabalar" jadvalidagi qatorni yangilash
    if (colStatus !== -1) {
      studentsSheet.getRange(studentRowIndex, colStatus + 1).setValue(CONFIG.PAYMENT_STATUS_ON_SUBMIT);
    }
    if (colAmount !== -1) {
      studentsSheet.getRange(studentRowIndex, colAmount + 1).setValue(Number(amount));
    }
    if (colReceipt !== -1) {
      studentsSheet.getRange(studentRowIndex, colReceipt + 1).setValue(receiptUrl);
    }
    if (colDate !== -1) {
      studentsSheet.getRange(studentRowIndex, colDate + 1).setValue(displayDate);
    }
    if (colTg !== -1) {
      const tgInfo = formatTelegramUser(telegramUser);
      studentsSheet.getRange(studentRowIndex, colTg + 1).setValue(tgInfo);
    }

    // Qarzdorlik ustunini yangilash (agar ustun bo'lsa va unda formula bo'lmasa)
    if (colDebt !== -1) {
      const debtCell = studentsSheet.getRange(studentRowIndex, colDebt + 1);
      if (!debtCell.getFormula()) {
        const totalFeeVal = (colTotalFee !== -1 && !isNaN(studentRowData[colTotalFee]) && studentRowData[colTotalFee] !== "")
          ? Number(studentRowData[colTotalFee])
          : 1800000;
        const newDebt = Math.max(0, totalFeeVal - Number(amount));
        debtCell.setValue(newDebt);
      }
    }

    // 5. "To'lovlar" (Tranzaksiyalar tarixi) varag'iga yangi qator qo'shish
    let paymentsSheet = ss.getSheetByName(CONFIG.PAYMENTS_SHEET_NAME);
    if (!paymentsSheet) {
      // Agar varaq bo'lmasa yaratamiz
      paymentsSheet = ss.insertSheet(CONFIG.PAYMENTS_SHEET_NAME);
      paymentsSheet.appendRow([
        "Tranzaksiya ID", "Sana va vaqt", "Talaba ID", "F.I.Sh.", "Fakultet",
        "Guruh", "Summa (so'm)", "Kvitansiya havolasi", "Holat", "Telegram Foydalanuvchi"
      ]);
      styleHeaderRow(paymentsSheet);
    }

    const transactionId = "TRX-" + Utilities.formatDate(now, CONFIG.TIMEZONE, "yyyyMMddHHmmss") + "-" + Math.floor(Math.random() * 900 + 100);
    paymentsSheet.appendRow([
      transactionId,
      displayDate,
      studentId,
      studentFullName,
      studentFaculty,
      studentGroup,
      Number(amount),
      receiptUrl,
      CONFIG.PAYMENT_STATUS_ON_SUBMIT,
      formatTelegramUser(telegramUser)
    ]);

    // Muvaffaqiyatli natija
    return createJsonResponse({
      success: true,
      message: "To'lov chekingiz muvaffaqiyatli qabul qilindi va tekshiruvga yuborildi.",
      data: {
        studentId: studentId,
        studentName: studentFullName,
        amount: Number(amount),
        receiptUrl: receiptUrl,
        date: displayDate,
        transactionId: transactionId
      }
    });

  } catch (error) {
    Logger.log("doPost xatolik: " + error.toString());
    return createJsonResponse({
      success: false,
      error: error.message || error.toString()
    });
  } finally {
    lock.releaseLock();
  }
}

/**
 * "Talabalar" varag'idan barcha talabalarni o'qib, ixcham JSON shakliga keltiradi
 */
function getAllStudents() {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.STUDENTS_SHEET_NAME);
  if (!sheet) {
    throw new Error(`'${CONFIG.STUDENTS_SHEET_NAME}' varag'i topilmadi. Jadval nomini tekshiring.`);
  }

  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) {
    return [];
  }

  const headers = values[0].map(h => String(h).trim().toLowerCase());
  const colId = findColumnIndex(headers, ["id", "talaba id", "student id"]);
  const colFaculty = findColumnIndex(headers, ["fakultet", "faculty"]);
  const colGroup = findColumnIndex(headers, ["guruh", "yo'nalish va guruh", "group"]);
  const colName = findColumnIndex(headers, ["f.i.sh.", "f.i.sh", "fish", "ism", "familiya"]);
  const colDorm = findColumnIndex(headers, ["yotoqxona", "yotoqxona raqami", "ttj"]);
  const colRoom = findColumnIndex(headers, ["xona", "xona raqami", "room"]);
  const colStatus = findColumnIndex(headers, ["holat", "to'lov holati", "status"]);
  const colTotalFee = findColumnIndex(headers, ["jami to'lov", "jami qarzdorlik", "belgilangan to'lov", "shartnoma", "jami"]);
  const colAmount = findColumnIndex(headers, ["summa", "to'langan summa", "to'langan", "amount"]);
  const colDebt = findColumnIndex(headers, ["qarzdorlik", "qoldiq qarz", "qoldiq qarzdorlik", "qoldiq", "qarz", "debt"]);

  const students = [];

  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const id = colId !== -1 ? String(row[colId]).trim() : "";
    const fullName = colName !== -1 ? String(row[colName]).trim() : "";

    // Agar ID yoki Ism bo'sh bo'lsa qatorni o'tkazib yuboramiz
    if (!id && !fullName) continue;

    const paidAmount = colAmount !== -1 && !isNaN(row[colAmount]) && row[colAmount] !== "" ? Number(row[colAmount]) : 0;
    
    // Belgilangan jami to'lov (agar jadvalda bo'lsa, aks holda standart 1 800 000 so'm)
    let totalFee = 1800000;
    if (colTotalFee !== -1 && !isNaN(row[colTotalFee]) && row[colTotalFee] !== "") {
      totalFee = Number(row[colTotalFee]);
    }

    // Qarzdorlik (jadvalda ustun bo'lsa o'sha qiymat, aks holda jami to'lov - to'langan summa)
    let debt = Math.max(0, totalFee - paidAmount);
    if (colDebt !== -1 && !isNaN(row[colDebt]) && row[colDebt] !== "") {
      debt = Number(row[colDebt]);
    }

    students.push({
      id: id || `ST-${i}`,
      faculty: colFaculty !== -1 ? String(row[colFaculty]).trim() : "Boshqa",
      group: colGroup !== -1 ? String(row[colGroup]).trim() : "Guruhsiz",
      fullName: fullName,
      dorm: colDorm !== -1 ? String(row[colDorm]).trim() : "Noma'lum",
      room: colRoom !== -1 ? String(row[colRoom]).trim() : "-",
      status: colStatus !== -1 && row[colStatus] ? String(row[colStatus]).trim() : "To'lanmagan",
      amount: paidAmount,
      totalFee: totalFee,
      debt: debt
    });
  }

  return students;
}

/**
 * Sarlavha variantlari bo'yicha ustun indeksini topish
 */
function findColumnIndex(headers, variations) {
  // 1-bosqich: Avval to'liq mos kelishni (exact match) tekshiramiz
  for (let i = 0; i < headers.length; i++) {
    const h = String(headers[i]).trim().toLowerCase();
    for (const v of variations) {
      if (h === String(v).trim().toLowerCase()) {
        return i;
      }
    }
  }

  // 2-bosqich: Agar to'liq mos kelmasa, qisman mos kelishni (substring) tekshiramiz
  // DIQQAT: "xona" qidirilganda "yotoqxona" ustuniga adashib mos kelmasligi shart!
  for (let i = 0; i < headers.length; i++) {
    const h = String(headers[i]).trim().toLowerCase();
    for (const v of variations) {
      const target = String(v).trim().toLowerCase();
      if (target.includes("xona") && h.includes("yotoqxona")) {
        continue;
      }
      if (h.includes(target)) {
        return i;
      }
    }
  }
  return -1;
}

/**
 * Telegram foydalanuvchi ma'lumotlarini qulay matn ko'rinishiga keltirish
 */
function formatTelegramUser(tgUser) {
  if (!tgUser || typeof tgUser !== "object") return "";
  const parts = [];
  if (tgUser.username) parts.push(`@${tgUser.username}`);
  if (tgUser.first_name) parts.push(tgUser.first_name);
  if (tgUser.last_name) parts.push(tgUser.last_name);
  if (tgUser.id) parts.push(`(ID: ${tgUser.id})`);
  return parts.join(" ");
}

/**
 * JSON javob obyektini MIME turi bilan qaytarish (CORS qo'llab-quvvatlaydi)
 */
function createJsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * ============================================================================
 * BIR MARTALIK SOZLASH FUNKSIYASI (SETUP FUNCTION)
 * ============================================================================
 * Ushbu funksiyani Apps Script muharririda bir marta ishga tushirsangiz,
 * jadvalingizda "Talabalar" va "To'lovlar" varaqlarini, professional
 * rangli sarlavhalar va namunaviy qatorlarni avtomatik yaratib beradi!
 */
function setupInitialSheets() {
  const ss = getSpreadsheet();

  // 1. "Talabalar" varag'ini sozlash
  let studentsSheet = ss.getSheetByName(CONFIG.STUDENTS_SHEET_NAME);
  if (!studentsSheet) {
    studentsSheet = ss.insertSheet(CONFIG.STUDENTS_SHEET_NAME);
  }

  const studentHeaders = [
    "ID", "Fakultet", "Guruh", "F.I.Sh.", "Yotoqxona",
    "Xona", "Holat", "Jami to'lov", "To'langan summa", "Qarzdorlik",
    "Kvitansiya havolasi", "Sana vaqti", "Telegram foydalanuvchi"
  ];

  if (studentsSheet.getLastRow() === 0) {
    studentsSheet.appendRow(studentHeaders);
    styleHeaderRow(studentsSheet);

    // Namunaviy 3 ta talaba
    studentsSheet.appendRow([
      "ST-1001", "Dasturiy injiniring", "DI-21-01", "Karimov Alisher Baxtiyor o'g'li",
      "1-yotoqxona", "204", "To'lanmagan", 1800000, 0, "=H2-I2", "", "", ""
    ]);
    studentsSheet.appendRow([
      "ST-1002", "Dasturiy injiniring", "DI-21-01", "Toshmatova Zilola Farhod qizi",
      "1-yotoqxona", "205", "To'lanmagan", 1800000, 0, "=H3-I3", "", "", ""
    ]);
    studentsSheet.appendRow([
      "ST-1003", "Kompyuter injiniringi", "KI-22-01", "Rustamov Jasur Jamshid o'g'li",
      "2-yotoqxona", "310", "To'langan", 1800000, 1800000, "=H4-I4", "https://drive.google.com", "2026-10-01 12:00:00", "@jasur"
    ]);
  }

  // 2. "To'lovlar" varag'ini sozlash
  let paymentsSheet = ss.getSheetByName(CONFIG.PAYMENTS_SHEET_NAME);
  if (!paymentsSheet) {
    paymentsSheet = ss.insertSheet(CONFIG.PAYMENTS_SHEET_NAME);
  }

  if (paymentsSheet.getLastRow() === 0) {
    const paymentHeaders = [
      "Tranzaksiya ID", "Sana va vaqt", "Talaba ID", "F.I.Sh.", "Fakultet",
      "Guruh", "Summa (so'm)", "Kvitansiya havolasi", "Holat", "Telegram Foydalanuvchi"
    ];
    paymentsSheet.appendRow(paymentHeaders);
    styleHeaderRow(paymentsSheet);
  }

  // 3. Drive papkani tayyorlash
  const folder = getReceiptsFolder();
  Logger.log("✅ Sozlash muvaffaqiyatli yakunlandi!");
  Logger.log("Drive papka havolasi: " + folder.getUrl());
}

/**
 * Sarlavhalarga korporativ akademik uslub berish
 */
function styleHeaderRow(sheet) {
  const headerRange = sheet.getRange(1, 1, 1, sheet.getLastColumn());
  headerRange.setBackground("#1E3A8A"); // To'q ko'k rang
  headerRange.setFontColor("#FFFFFF"); // Oq yozuv
  headerRange.setFontWeight("bold");
  headerRange.setFontFamily("Arial");
  headerRange.setHorizontalAlignment("center");
  sheet.setFrozenRows(1);
}

/**
 * ============================================================================
 * JADVAL USTUNLARINI AVTOMATIK TARTIBGA KELTIRISH FUNKSIYASI
 * ============================================================================
 * Ushbu funksiyani Apps Script-da bir marta 'Run' qilsangiz, mavjud jadvalingizni:
 * [Jami to'lov] -> [To'langan summa] -> [Qarzdorlik]
 * ketma-ketligida to'g'irlab, barcha qatorlarga formulalarni avtomatik joylaydi!
 */
function updateStudentSheetColumns() {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.STUDENTS_SHEET_NAME);
  if (!sheet) throw new Error(`'${CONFIG.STUDENTS_SHEET_NAME}' varag'i topilmadi.`);

  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return;

  const data = sheet.getDataRange().getValues();
  const headers = data[0].map(h => String(h).trim().toLowerCase());

  const colId = findColumnIndex(headers, ["id", "talaba id"]);
  const colFaculty = findColumnIndex(headers, ["fakultet"]);
  const colGroup = findColumnIndex(headers, ["guruh"]);
  const colName = findColumnIndex(headers, ["f.i.sh.", "f.i.sh", "fish", "ism"]);
  const colDorm = findColumnIndex(headers, ["yotoqxona"]);
  const colRoom = findColumnIndex(headers, ["xona"]);
  const colStatus = findColumnIndex(headers, ["holat"]);
  const colTotalFee = findColumnIndex(headers, ["jami to'lov", "shartnoma"]);
  const colAmount = findColumnIndex(headers, ["to'langan summa", "summa"]);
  const colDebt = findColumnIndex(headers, ["qarzdorlik"]);
  const colReceipt = findColumnIndex(headers, ["kvitansiya", "kvitansiya havolasi"]);
  const colDate = findColumnIndex(headers, ["sana vaqti", "sana"]);
  const colTg = findColumnIndex(headers, ["telegram foydalanuvchi", "telegram"]);

  const newRows = [];
  const targetHeaders = [
    "ID", "Fakultet", "Guruh", "F.I.Sh.", "Yotoqxona",
    "Xona", "Holat", "Jami to'lov", "To'langan summa", "Qarzdorlik",
    "Kvitansiya havolasi", "Sana vaqti", "Telegram foydalanuvchi"
  ];
  newRows.push(targetHeaders);

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const totalFee = (colTotalFee !== -1 && row[colTotalFee] !== "" && !isNaN(row[colTotalFee])) ? Number(row[colTotalFee]) : 1800000;
    const paid = (colAmount !== -1 && row[colAmount] !== "" && !isNaN(row[colAmount])) ? Number(row[colAmount]) : 0;
    const rowNum = i + 1;

    newRows.push([
      colId !== -1 ? row[colId] : `ST-${i}`,
      colFaculty !== -1 ? row[colFaculty] : "",
      colGroup !== -1 ? row[colGroup] : "",
      colName !== -1 ? row[colName] : "",
      colDorm !== -1 ? row[colDorm] : "",
      colRoom !== -1 ? row[colRoom] : "",
      colStatus !== -1 && row[colStatus] ? row[colStatus] : "To'lanmagan",
      totalFee,
      paid,
      `=H${rowNum}-I${rowNum}`, // Qarzdorlik formulasi: Jami to'lov - To'langan summa
      colReceipt !== -1 ? row[colReceipt] : "",
      colDate !== -1 ? row[colDate] : "",
      colTg !== -1 ? row[colTg] : ""
    ]);
  }

  sheet.getRange(1, 1, newRows.length, targetHeaders.length).setValues(newRows);
  styleHeaderRow(sheet);
  SpreadsheetApp.flush();
}
