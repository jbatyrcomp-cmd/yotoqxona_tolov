# Yotoqxona To'lov Kvitansiyalari Tizimi — To'liq Qo'llanma

Ushbu loyiha 6 000 nafargacha talaba uchun yotoqxona to'lov cheklarini ortiqcha login/parollarsiz, Google Sheets va Google Drive bilan to'liq integratsiya qilingan Telegram Mini App (TMA) orqali yig'ishga mo'ljallangan.

---

## 1. Google Sheets Jadvali Strukturasi

Yangi Google Sheets oching (masalan, `Yotoqxona To'lovlari 2026`). Unda 2 ta varaq bo'ladi:

### 1-varaq: `Talabalar` (Asosiy baza)
Birinchi qator (sarlavhalar) quyidagi tartibda bo'lishi lozim:

| Ustun | Nomi | Izoh / Misol |
|---|---|---|
| **A** | `ID` | Unikal talaba kodi (masalan, `ST-1001`) |
| **B** | `Fakultet` | Masalan: `Dasturiy injiniring` |
| **C** | `Guruh` | Masalan: `DI-21-01` |
| **D** | `F.I.Sh.` | Masalan: `Karimov Alisher Baxtiyor o'g'li` |
| **E** | `Yotoqxona` | Masalan: `1-yotoqxona` |
| **F** | `Xona` | Masalan: `204` |
| **G** | `Holat` | `To'lanmagan`, `Tekshiruvda` yoki `To'langan` |
| **H** | `Jami to'lov` | Belgilangan to'lov (masalan: `1800000`) |
| **I** | `To'langan summa` | To'langan summa (masalan: `0` yoki `1800000`) |
| **J** | `Qarzdorlik` | Qoldiq qarz, formula: `=H2-I2` |
| **K** | `Kvitansiya havolasi` | Drive-dagi chek rasmiga avtomatik havola |
| **L** | `Sana vaqti` | To'lov yuborilgan sana va vaqt |
| **M** | `Telegram foydalanuvchi` | Masalan: `@alisher (ID: 12345678)` |

> **Maslahat:** Papkadagi `sample_students.csv` faylini Google Sheets-ga to'g'ridan-to'g'ri yuklab olib (`File -> Import`), ustiga o'z talabalaringiz ro'yxatini joylashingiz mumkin.

### 2-varaq: `To'lovlar` (Audit va Tranzaksiyalar tarixi)
Ushbu varaqqa har bir yuborilgan to'lov alohida qator bo'lib yoziladi.
- Ustunlar: `Tranzaksiya ID`, `Sana va vaqt`, `Talaba ID`, `F.I.Sh.`, `Fakultet`, `Guruh`, `Summa (so'm)`, `Kvitansiya havolasi`, `Holat`, `Telegram Foydalanuvchi`.

---

## 2. Google Apps Script Backendni O'rnatish

1. Google Sheets jadvalingizni oching.
2. Yuqori menyudan **Kengaytmalar (Extensions)** -> **Apps Script** bo'limiga kiring.
3. Ochilgan tahrirlovchida barcha mavjud kodni o'chirib, loyihadagi `Code.gs` fayli tarkibini to'liq nusxalab joylashtiring.
4. **Google Drive Papka yaratish:**
   - [Google Drive](https://drive.google.com) ga kiring.
   - Yangi papka oching (masalan, `Yotoqxona Cheklari 2026`).
   - Papkani oching va brauzer manzilidagi oxirgi ID qismini oling:
     `https://drive.google.com/drive/folders/1aBcDeFgHiJkLmNoP...` -> mana shu `1aBcDeFgHiJkLmNoP...` ID hisoblanadi.
5. `Code.gs` dagi `CONFIG` qismida papka ID sini kiriting:
   ```javascript
   const CONFIG = {
     SPREADSHEET_ID: "", // Bo'sh qoldiring (avtomatik faol jadval olinadi)
     DRIVE_FOLDER_ID: "1aBcDeFgHiJkLmNoP...", // Yuqoridagi papka ID si
     ...
   };
   ```
6. **Boshlang'ich sozlash (Setup):**
   - Yuqori paneldagi funksiyalar ro'yxatidan `setupInitialSheets` ni tanlang va **Run (Ishga tushirish)** tugmasini bosing.
   - Google hisobingizga ruxsat berish so'raladi (*Review permissions -> Advanced -> Go to ... (unsafe) -> Allow*).
   - Bu funksiya jadvalingizda kerakli varaqlar va sarlavhalarni chiroyli qilib formatlab beradi.

---

## 3. Web App Sifatida Deploy Qilish

1. Apps Script yuqori o'ng burchagidagi ko'k **Deploy (Joylashtirish)** tugmasini bosing -> **New deployment (Yangi joylashtirish)**.
2. Chapdagi tishli g'ildirak (Gear) belgisini bosib, **Web app** turini tanlang.
3. Parametrlarni quyidagicha belgilang:
   - **Description**: `Yotoqxona To'lov API v1`
   - **Execute as**: `Me (mening nomimdan)`
   - **Who has access**: `Anyone (Har kim)`  *(Juda muhim: Telegram Mini App loginlarsiz ishlashi uchun aynan "Anyone" bo'lishi shart)*
4. **Deploy** tugmasini bosing.
5. Sizga **Web App URL** beriladi:
   `https://script.google.com/macros/s/AKfycb.../exec`
   Ushbu URL manzilni nusxalab oling!

---

## 4. Frontend (`index.html`) Sozlash va Joylashtirish

1. `index.html` faylini oching.
2. Skript boshidagi `BACKEND_URL` o'zgaruvchisiga o'zingizning Google Apps Script Web App havolangizni qo'ying:
   ```javascript
   const BACKEND_URL = "https://script.google.com/macros/s/AKfycb.../exec";
   ```
3. `index.html` ni bepul va xavfsiz HTTPS hostingga joylashtiring:
   - **Variant A (GitHub Pages - Tavsiya etiladi):**
     1. GitHub-da yangi ochiq (public) repozitoriy oching.
     2. `index.html` faylini yuklang.
     3. *Settings -> Pages* bo'limidan `main` branch-ni tanlab saqlang. Havolangiz: `https://username.github.io/reponame/` bo'ladi.
   - **Variant B (Vercel / Netlify):**
     1. [vercel.com](https://vercel.com) yoki [netlify.com](https://netlify.com) ga kiring.
     2. `index.html` joylashgan papkani sudrab olib borib tashlang (Drag & Drop).
     3. 5 soniyada tayyor HTTPS havola beriladi.

---

## 5. Telegram Bot Yaratish va Mini App (TMA) Ulash

1. Telegramda [@BotFather](https://t.me/BotFather) ga kiring.
2. Yangi bot yarating: `/newbot` buyrug'ini yuboring, nomi va username bering.
3. Bot yaratilgach, Web App menyu tugmasini sozlang:
   - `/setmenubutton` buyrug'ini yuboring.
   - Botingizni tanlang.
   - Tugma nomini yozing: `🏢 To'lov qilish`
   - Vercel/GitHub Pages dagi `index.html` havolasini yuboring (masalan, `https://username.github.io/tolov/`).
4. (Ixtiyoriy) Botga to'g'ridan-to'g'ri Mini App inline havola yaratish:
   - [@BotFather](https://t.me/BotFather) da `/newapp` buyrug'ini bering va ko'rsatmalarga asosan qisqa havola (masalan `t.me/sizning_botingiz/app`) oling.

---

## 6. Afzalliklari va Xavfsizlik

- **Mijoz tomonda rasmni siqish:** Mobil kameralar 10-20 MB hajmda suratga oladi. Mini App uni avtomatik HTML5 Canvas orqali ~500 KB ga siqadi. Natijada chek 1 soniyada yuklanadi va server cheklovlariga uchramaydi.
- **LockService (Poygaga qarshi qulf):** Bir vaqtning o'zida yuzlab talabalar chek yuborgan taqdirda ham, Google Sheets-dagi qatorlar chalkashib ketmaydi.
- **Tezkor kaskadli filtr:** 6 000 talabaning ma'lumoti bitta yengil JSON sifatida brauzerga olinadi va qidiruv millisekundlarda ishlaydi.
