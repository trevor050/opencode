const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  const filePath = `file://${__dirname}/report.html`;
  console.log(`Loading HTML from: ${filePath}`);
  
  await page.goto(filePath, { waitUntil: 'networkidle' });
  
  await page.pdf({
    path: `${__dirname}/report.pdf`,
    format: 'A4',
    margin: {
      top: '1in',
      right: '1in',
      bottom: '1in',
      left: '1in'
    },
    printBackground: true,
    displayHeaderFooter: false
  });
  
  console.log('✓ PDF generated successfully: report.pdf');
  await browser.close();
})();
