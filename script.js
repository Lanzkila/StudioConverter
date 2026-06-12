const fileInput = document.getElementById('file-input');
const statusText = document.getElementById('status-text');
const progressFill = document.getElementById('progress-fill');
const percentageText = document.getElementById('percentage');
const allBtns = document.querySelectorAll('.btn-exec');

function disableBtns(state) { allBtns.forEach(b => b.disabled = state); }

function updateProgress(current, total, msg) {
    const percent = Math.round((current / total) * 100);
    progressFill.style.width = percent + '%';
    percentageText.innerText = percent + '%';
    statusText.innerText = `${msg}: ${current}/${total}`;
}

document.getElementById('pdf-btn').onclick = async function() {
    const files = fileInput.files;
    if (files.length === 0) return alert("Pilih fail dulu!");
    disableBtns(true);

    try {
        const firstFile = files[0];
        
        if (firstFile.type === "application/pdf" || firstFile.name.toLowerCase().endsWith('.pdf')) {
            statusText.innerText = "MERGING PDFS...";
            const mergedPdf = await PDFLib.PDFDocument.create();
            for (let i = 0; i < files.length; i++) {
                updateProgress(i + 1, files.length, "Merging");
                const pdfBytes = await files[i].arrayBuffer();
                const pdfDoc = await PDFLib.PDFDocument.load(pdfBytes);
                const copiedPages = await mergedPdf.copyPages(pdfDoc, pdfDoc.getPageIndices());
                copiedPages.forEach((page) => mergedPdf.addPage(page));
            }
            const mergedPdfBytes = await mergedPdf.save();
            downloadBlob(new Blob([mergedPdfBytes]), "Merged_MangaStudio.pdf");
            statusText.innerText = "MERGE COMPLETED!";
        } 
        
        else if (firstFile.name.match(/\.(zip|cbz)$/i)) {
            const zip = await JSZip.loadAsync(firstFile);
            const images = Object.keys(zip.files).filter(name => name.match(/\.(jpg|jpeg|png|webp)$/i) && !name.includes('__MACOSX')).sort((a, b) => a.localeCompare(b, undefined, {numeric: true}));
            await createPdfFromImages(images, zip, firstFile.name.replace(/\.[^/.]+$/, ""));
        }
       
        else {
            const imagesData = Array.from(files).filter(f => f.type.startsWith('image/')).sort((a, b) => a.name.localeCompare(b.name, undefined, {numeric: true}));
            await createPdfFromRawImages(imagesData, "Converted_Images");
        }
    } catch (e) { 
        console.error(e);
        alert("Ralat PDF! Pastikan fail betul."); 
    }
    disableBtns(false);
};

async function createPdfFromImages(imageNames, zip, outputName) {
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ unit: 'px', compress: true });

    for (let i = 0; i < imageNames.length; i++) {
        updateProgress(i + 1, imageNames.length, "Rendering PDF");
        const blob = await zip.files[imageNames[i]].async("blob");
        const url = URL.createObjectURL(blob);
        const img = await loadImage(url);
        const processedData = processImage(img, document.getElementById('width-select').value, document.getElementById('quality-range').value);
        const pdfWidth = pdf.internal.pageSize.getWidth();
        const imgProps = pdf.getImageProperties(processedData);
        const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;

        if (i > 0) pdf.addPage([pdfWidth, pdfHeight]);
        else pdf.setPage(1); // Ensure first page size is correct
        pdf.addImage(processedData, 'JPEG', 0, 0, pdfWidth, pdfHeight, undefined, 'FAST');
        URL.revokeObjectURL(url);
    }
    pdf.save(outputName + ".pdf");
    statusText.innerText = "PDF COMPLETED!";
}

async function createPdfFromRawImages(fileList, outputName) {
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ unit: 'px', compress: true });

    for (let i = 0; i < fileList.length; i++) {
        updateProgress(i + 1, fileList.length, "Processing Images");
        const url = URL.createObjectURL(fileList[i]);
        const img = await loadImage(url);
        const processedData = processImage(img, document.getElementById('width-select').value, document.getElementById('quality-range').value);
        const pdfWidth = pdf.internal.pageSize.getWidth();
        const imgProps = pdf.getImageProperties(processedData);
        const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;

        if (i > 0) pdf.addPage([pdfWidth, pdfHeight]);
        pdf.addImage(processedData, 'JPEG', 0, 0, pdfWidth, pdfHeight, undefined, 'FAST');
        URL.revokeObjectURL(url);
    }
    pdf.save(outputName + ".pdf");
    statusText.innerText = "IMAGE TO PDF DONE!";
}

document.getElementById('cbz-btn').onclick = async function() {
    const files = fileInput.files;
    if (files.length === 0) return alert("Pilih fail dulu!");
    disableBtns(true);

    try {
        const newZip = new JSZip();
        if (files[0].name.match(/\.(zip|cbz)$/i)) {
            const zip = await JSZip.loadAsync(files[0]);
            const images = Object.keys(zip.files).filter(name => name.match(/\.(jpg|jpeg|png|webp)$/i) && !name.includes('__MACOSX'));
            for (let i = 0; i < images.length; i++) {
                updateProgress(i + 1, images.length, "Packing CBZ");
                const imgData = await zip.files[images[i]].async("uint8array");
                newZip.file(images[i].split('/').pop(), imgData);
            }
        } else {
            // Repack raw images to CBZ
            const images = Array.from(files).filter(f => f.type.startsWith('image/'));
            for (let i = 0; i < images.length; i++) {
                updateProgress(i + 1, images.length, "Packing CBZ");
                const imgData = await images[i].arrayBuffer();
                newZip.file(images[i].name, imgData);
            }
        }

        const content = await newZip.generateAsync({type: "blob"});
        downloadBlob(content, (files[0].name.split('.')[0] || "Manga") + ".cbz");
        statusText.innerText = "CBZ COMPLETED!";
    } catch (e) { alert("CBZ Error!"); }
    disableBtns(false);
};

function processImage(img, targetWidth, quality) {
    const canvas = document.createElement('canvas');
    let w = img.width, h = img.height;
    if (targetWidth !== 'original' && w > parseInt(targetWidth)) {
        const ratio = parseInt(targetWidth) / w;
        w = parseInt(targetWidth); h = h * ratio;
    }
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL('image/jpeg', quality / 100);
}

function loadImage(url) { return new Promise(res => { const i = new Image(); i.onload = () => res(i); i.src = url; }); }

function downloadBlob(blob, name) {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = name;
    link.click();
}

fileInput.onchange = (e) => { 
    if(e.target.files.length > 0) {
        const count = e.target.files.length;
        document.getElementById('file-name').innerText = count > 1 ? `${count} Files Selected` : e.target.files[0].name;
    }
};
        document.getElementById("current-year").innerText = new Date().getFullYear();
