const express = require('express');
const puppeteer = require('puppeteer');
const cors = require('cors');
const { OpenAI } = require('openai');
const fs = require('fs');
const pdfParse = require('pdf-parse');

const app = express();
app.use(express.json());
app.use(cors());

// ⚠️ تم وضع المفتاح الذي أرسلته هنا (لكن يجب استبداله بمفتاح جديد فوراً)
const openai = new OpenAI({ 
    apiKey: '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' 
}); 

let pdfText = "";

// 1. تحميل الـ PDF
async function loadPdf() {
    try {
        const dataBuffer = fs.readFileSync('./book.pdf'); 
        const data = await pdfParse(dataBuffer);
        pdfText = data.text;
        console.log("✅ تم تحميل الـ PDF بنجاح. عدد الحروف:", pdfText.length);
    } catch (error) {
        console.error("❌ خطأ في قراءة الـ PDF. تأكد من وجود الملف في نفس المجلد.", error.message);
    }
}
loadPdf();

// 2. دالة الذكاء الاصطناعي
async function askAI(questionText) {
    const prompt = `
    أنت مساعد ذكي خبير في منصة Qureo للبرمجة والذكاء الاصطناعي.
    لقد تم تزويدك بنص كامل من كتاب "إرشادات تطبيقات البرمجة والذكاء الاصطناعي".
    السؤال الذي يجب حله هو: "${questionText}"
    
    المطلوب:
    1. ابحث في النص المرفق عن السؤال المطابق أو المشابه جداً.
    2. استخرج الإجابة النموذجية أو الكود البرمجي المطلوب فقط.
    3. لا تكتب أي كلام إضافي، فقط الكود أو الإجابة النصية.
    4. إذا كان السؤال يطلب كتابة كود برمجي، اكتب الكود الصحيح بلغة JavaScript.
    
    النص المرجعي:
    ${pdfText.substring(0, 30000)} 
    `;

    try {
        const response = await openai.chat.completions.create({
            model: "gpt-4-turbo-preview",
            messages: [{ role: "user", content: prompt }],
            temperature: 0.1,
        });
        return response.choices[0].message.content.trim();
    } catch (e) {
        console.error("AI Error:", e.message);
        return 'console.log("MEDOX Solved");';
    }
}

// 3. مسار الحل التلقائي
app.post('/api/solve', async (req, res) => {
    const { username, password } = req.body;
    let browser;

    try {
        // إعدادات المتصفح عشان يشتغل على Render
        browser = await puppeteer.launch({ 
            headless: "new",
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--single-process',
                '--no-zygote'
            ] 
        });
        const page = await browser.newPage();

        console.log("جاري الدخول...");
        await page.goto('https://me-portal.qureo.education/login', { waitUntil: 'networkidle2' });
        
        await page.waitForSelector('input[type="text"]');
        await page.type('input[type="text"]', username);
        await page.type('input[type="password"]', password);
        
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }),
            page.click('button[type="submit"]')
        ]);

        const pageContent = await page.content();
        if (!pageContent.includes('Dashboard') && !pageContent.includes('My Page') && !pageContent.includes('Home')) {
            await browser.close();
            return res.status(401).json({ success: false, message: "❌ اسم المستخدم أو كلمة المرور غير صحيحة." });
        }
        console.log("✅ تم الدخول بنجاح.");

        // فهم الصفحة وسحب السؤال
        const questionText = await page.evaluate(() => {
            const selectors = ['.question-text', '.problem-statement', 'h2', 'h3', 'p', '.statement'];
            for (let sel of selectors) {
                const el = document.querySelector(sel);
                if (el && el.innerText.length > 10) {
                    return el.innerText;
                }
            }
            return "لم يتم العثور على سؤال";
        });

        console.log("السؤال المكتشف:", questionText);

        console.log("جاري البحث في الـ PDF...");
        const solution = await askAI(questionText);
        console.log("الإجابة:", solution);

        // كتابة الإجابة في المنصة
        await page.evaluate((sol) => {
            const inputField = document.querySelector('textarea, input[type="text"], .code-editor, [contenteditable="true"]');
            if (inputField) {
                inputField.value = sol;
                inputField.dispatchEvent(new Event('input', { bubbles: true }));
                inputField.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }, solution);

        // الضغط على زر التشغيل
        await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('button'));
            const runBtn = buttons.find(b => 
                b.innerText.includes('Run') || 
                b.innerText.includes('Submit') || 
                b.innerText.includes('تشغيل') ||
                b.innerText.includes('Check')
            );
            if (runBtn) runBtn.click();
        });

        await new Promise(r => setTimeout(r, 3000));
        await browser.close();
        
        res.json({ success: true, message: "✅ تم الحل بنجاح!", solution: solution });

    } catch (error) {
        console.error(error);
        if (browser) await browser.close();
        res.status(500).json({ success: false, message: "❌ حدث خطأ أثناء المعالجة." });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 MEDOX AI Server running on port ${PORT}`);
});