    document.getElementById('y').textContent = new Date().getFullYear();

    // 1. AUTO-LOAD: Panggil data masa blog dibuka
    window.addEventListener('load', function() {
      const ids = ['cvarBox', 'addonBox', 'scriptBox'];
      ids.forEach(id => {
        const savedData = localStorage.getItem('auto_' + id);
        if (savedData) {
          document.getElementById(id).value = savedData;
        }
      });
    });

    // 2. AUTO-SAVE: Simpan setiap kali ada perubahan teks
    function saveData(id) {
      const val = document.getElementById(id).value;
      localStorage.setItem('auto_' + id, val);
    }

    // 3. COPY FUNCTION
    function copyIt(id) {
      const t = document.getElementById(id);
      t.select();
      t.setSelectionRange(0, 99999);
      document.execCommand('copy');
      alert('Berjaya disalin!');
    }

    // 4. CLEAR FUNCTION: Padam teks & local storage
    function clearIt(id) {
      if(confirm('Padam semua kandungan?')) {
        document.getElementById(id).value = '';
        localStorage.removeItem('auto_' + id);
      }
    }

    // 5. DOWNLOAD FUNCTION
    function dl(id, filename) {
      const val = document.getElementById(id).value;
      if(!val) return alert('Kotak kosong!');
      const blob = new Blob([val], {type: 'text/plain'});
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);
    }

document.querySelectorAll('textarea').forEach(t => {
    t.addEventListener('focus', () => {
        t.style.borderColor = '#58a6ff';
        t.style.boxShadow = '0 0 12px rgba(88, 166, 255, 0.4)';
    });
    t.addEventListener('blur', () => {
        t.style.borderColor = '#30363d';
        t.style.boxShadow = 'none';
    });
});

document.querySelectorAll('textarea').forEach(t => {
    t.addEventListener('keydown', function(e) {
        if (e.ctrlKey && e.key === 'f') {
            e.preventDefault();
            const search = prompt("Cari perkataan:");
            if (search) {
                const count = this.value.split(search).length - 1;
                alert(`Jumpa ${count} kali perkataan "${search}"`);
            }
        }
    });
});

document.querySelectorAll('textarea').forEach(t => {
    t.addEventListener('dragover', e => { e.preventDefault(); t.style.background = '#1c2128'; });
    t.addEventListener('dragleave', () => { t.style.background = '#010409'; });
    t.addEventListener('drop', e => {
        e.preventDefault();
        const file = e.dataTransfer.files[0];
        const reader = new FileReader();
        reader.onload = (f) => { t.value = f.target.result; t.dispatchEvent(new Event('input')); };
        reader.readAsText(file);
    });
});

document.querySelectorAll('textarea').forEach(t => {
    t.addEventListener('contextmenu', e => {
        t.select();
    });
});

document.querySelectorAll('textarea').forEach(t => {
    t.addEventListener('input', () => {
        if(t.selectionStart === t.value.length) {
            t.scrollTop = t.scrollHeight;
        }
    });
});

document.querySelectorAll('textarea').forEach(t => {
    t.addEventListener('blur', () => localStorage.setItem('pos_' + t.id, t.selectionStart));
    window.addEventListener('load', () => {
        const pos = localStorage.getItem('pos_' + t.id);
        if (pos) t.setSelectionRange(pos, pos);
    });
});

document.querySelectorAll('textarea').forEach(t => {
    t.style.scrollBehavior = 'smooth';
});

document.querySelectorAll('textarea').forEach(t => {
    t.addEventListener('input', () => {
        if (t.value.startsWith(' ')) t.value = t.value.trimStart();
    });
});

let lockTimer;
document.querySelectorAll('textarea').forEach(t => {
    const resetTimer = () => {
        t.readOnly = false;
        clearTimeout(lockTimer);
        lockTimer = setTimeout(() => { t.readOnly = true; showNotif("Editor Locked (Idle)"); }, 600000);
    };
    t.addEventListener('keydown', resetTimer);
});

document.querySelectorAll('textarea').forEach(t => {
    t.addEventListener('keypress', e => {
        if (e.key === '*') {
            const pos = t.selectionStart;
            if (t.value[pos-1] === '/') {
                t.value = t.value.substring(0, pos) + " *  */" + t.value.substring(pos);
                t.setSelectionRange(pos + 2, pos + 2);
            }
        }
    });
});

document.querySelectorAll('textarea').forEach(t => {
    t.addEventListener('keydown', e => {
        if (e.key === ';' && t.value[t.selectionStart] === ';') {
            e.preventDefault();
            t.selectionStart++; t.selectionEnd = t.selectionStart;
        }
    });
});

document.querySelectorAll('textarea').forEach(t => {
    t.addEventListener('input', () => {
        t.value = t.value.replace(/\b(SV_|CL_)\w+/g, m => m.toLowerCase());
    });
});

document.querySelectorAll('textarea').forEach(t => {
    t.addEventListener('paste', () => {
        setTimeout(() => {
            const start = t.selectionStart;
            const lines = t.value.split('\n');
            t.value = lines.map(l => l.trim() && !l.startsWith(' ') ? "    " + l : l).join('\n');
        }, 50);
    });
});

document.querySelectorAll('textarea').forEach(t => {
    t.addEventListener('blur', () => {
        t.value = t.value.replace(/^(\] |\(con\) ).*$/gm, "");
    });
});

let lastPaste = "";
document.querySelectorAll('textarea').forEach(t => {
    t.addEventListener('paste', e => {
        const txt = e.clipboardData.getData('text');
        if (txt === lastPaste) e.preventDefault();
        lastPaste = txt;
    });
});

// --- GOOGLE-STYLE BORDER ONLY (SYNCED COLORS) ---
(function injectGoogleBorderOnly() {
    const style = document.createElement('style');
    style.innerHTML = `
        :root { --google-border: #4285F4; } /* Warna asal */

        textarea {
            transition: border-color 0.8s ease, box-shadow 0.8s ease !important;
            border: 1px solid #30363d !important; /* Warna asal sebelum fokus */
        }

        /* Kesan bila kotak diklik (Focus) */
        textarea:focus {
            border-color: var(--google-border) !important;
            box-shadow: 0 0 12px var(--google-border) !important;
            border-width: 2px !important;
            outline: none !important;
        }
    `;
    document.head.appendChild(style);

    const warnaGoogle = ['#4285F4', '#EA4335', '#FBBC05', '#34A853'];
    let i = 0;

    // Tukar suis warna setiap 2 saat supaya border bertukar warna dengan tenang
    setInterval(() => {
        i = (i + 1) % warnaGoogle.length;
        document.documentElement.style.setProperty('--google-border', warnaGoogle[i]);
    }, 2000); 
})();

// --- FIX FINAL 100%: KURSOR GOOGLE AI (TIADA BUG) ---
(function kursorGooglePure() {
    // 1. Cipta pembolehubah warna CSS (--warna-kursor)
    const style = document.createElement('style');
    style.innerHTML = `
        :root { --warna-kursor: #4285F4; } /* Warna asal: Biru */

        textarea {
            /* Guna pembolehubah warna yang kita buat */
            caret-color: var(--warna-kursor) !important;
            caret-width: 1px !important;
            transition: caret-color 0.2s ease-in-out;
        }
    `;
    document.head.appendChild(style);

    const warnaGoogle = ['#4285F4', '#EA4335', '#FBBC05', '#34A853'];
    let i = 0;

    // 2. Tukar warna setiap 1 saat (Masa standard kursor berkelip)
    // Kita tak kacau 'blink', kita cuma tukar 'cat' warna dia sahaja
    setInterval(() => {
        i = (i + 1) % warnaGoogle.length;
        document.documentElement.style.setProperty('--warna-kursor', warnaGoogle[i]);
    }, 1000); 
})();

// --- GOOGLE AI SHIMMER LINE (KESAN BERKILAT) ---
(function injectGoogleShimmer() {
    const style = document.createElement('style');
    style.innerHTML = `
        .shimmer-line {
            height: 2px;
            width: 100%;
            margin-top: -15px;
            margin-bottom: 15px;
            border-radius: 2px;
            background: linear-gradient(90deg, #4285F4, #EA4335, #FBBC05, #34A853, #4285F4);
            background-size: 300% 100%;
            animation: shimmerMove 4s linear infinite;
            opacity: 0.6;
        }

        @keyframes shimmerMove {
            0% { background-position: 100% 0%; }
            100% { background-position: 0% 0%; }
        }
    `;
    document.head.appendChild(style);

    // Masukkan garisan ini secara automatik di bawah setiap textarea
    document.querySelectorAll('textarea').forEach(t => {
        const line = document.createElement('div');
        line.className = 'shimmer-line';
        t.parentNode.insertBefore(line, t.nextSibling);
    });
})();

// --- GOOGLE AI LOADING DOTS (DECORATION) ---
(function injectGoogleDots() {
    const style = document.createElement('style');
    style.innerHTML = `
        .google-dots {
            display: flex;
            gap: 6px;
            padding: 10px 0;
            justify-content: center;
        }
        .dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            animation: googleJump 1.4s infinite ease-in-out;
        }
        .dot:nth-child(1) { background: #4285F4; animation-delay: -0.32s; }
        .dot:nth-child(2) { background: #EA4335; animation-delay: -0.16s; }
        .dot:nth-child(3) { background: #FBBC05; animation-delay: -0.08s; }
        .dot:nth-child(4) { background: #34A853; }

        @keyframes googleJump {
            0%, 80%, 100% { transform: scale(0); }
            40% { transform: scale(1.0); }
        }
    `;
    document.head.appendChild(style);

    // Letak dots ini secara automatik di atas setiap card editor
    document.querySelectorAll('.card').forEach(card => {
        const dotsContainer = document.createElement('div');
        dotsContainer.className = 'google-dots';
        dotsContainer.innerHTML = '<div class="dot"></div><div class="dot"></div><div class="dot"></div><div class="dot"></div>';
        card.prepend(dotsContainer);
    });
})();

// --- GOOGLE AI GRADIENT PROGRESS BAR (TOP) ---
(function injectGoogleAIBar() {
    // 1. Suntik CSS untuk bar yang 'beralun' warnanya
    const style = document.createElement('style');
    style.innerHTML = `
        #google-ai-bar {
            position: fixed;
            top: 0;
            left: 0;
            width: 0%;
            height: 3px;
            z-index: 100000;
            /* Warna Gradient Google AI */
            background: linear-gradient(90deg, #4285F4, #EA4335, #FBBC05, #34A853, #4285F4);
            background-size: 200% 100%;
            transition: width 0.3s ease-out, opacity 0.5s ease;
            /* Animasi warna bergerak (Shimmer) */
            animation: aiBarMove 2s linear infinite;
            box-shadow: 0 1px 10px rgba(66, 133, 244, 0.3);
            opacity: 0;
        }

        @keyframes aiBarMove {
            0% { background-position: 200% 0; }
            100% { background-position: 0 0; }
        }
    `;
    document.head.appendChild(style);

    // 2. Cipta elemen bar
    const bar = document.createElement('div');
    bar.id = 'google-ai-bar';
    document.body.prepend(bar);

    // 3. Fungsi Utama untuk Jalankan Bar (Macam Google AI)
    window.triggerGoogleBar = function() {
        bar.style.opacity = '1';
        bar.style.width = '0%';
        
        // Simulasi pergerakan laju (0% -> 70% -> 100%)
        setTimeout(() => { bar.style.width = '30%'; }, 10);
        setTimeout(() => { bar.style.width = '70%'; }, 400);
        setTimeout(() => { 
            bar.style.width = '100%'; 
            setTimeout(() => {
                bar.style.opacity = '0';
                setTimeout(() => { bar.style.width = '0%'; }, 500);
            }, 400);
        }, 800);
    };

    // 4. Jalankan bar secara automatik bila page siap load (Trigger awal)
    window.addEventListener('load', triggerGoogleBar);

    // 5. Bonus: Jalankan bar setiap kali user tekan butang COPY atau DOWNLOAD
    document.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', triggerGoogleBar);
    });
})();

// --- GOOGLE AI BORDER FLOW (WARNA BERPUSING SEKELILING KOTAK) ---
(function suntikBorderBerpusing() {
    const gaya = document.createElement('style');
    gaya.innerHTML = `
        /* Animasi warna berlari mengelilingi border */
        @keyframes borderPusing {
            0% { border-color: #4285F4; box-shadow: 2px -2px 15px #4285F4; }
            25% { border-color: #EA4335; box-shadow: 2px 2px 15px #EA4335; }
            50% { border-color: #FBBC05; box-shadow: -2px 2px 15px #FBBC05; }
            75% { border-color: #34A853; box-shadow: -2px -2px 15px #34A853; }
            100% { border-color: #4285F4; box-shadow: 2px -2px 15px #4285F4; }
        }

        /* Kelas untuk aktifkan pusingan */
        .google-ai-rotate {
            animation: borderPusing 1.2s linear infinite !important;
            border-width: 2px !important;
            border-style: solid !important;
            z-index: 10;
        }

        textarea {
            transition: border-color 0.5s ease, box-shadow 0.5s ease;
        }
    `;
    document.head.appendChild(gaya);

    // Fungsi untuk pusingkan warna 1 kali (Macam masuk Mode AI)
    window.pusingWarnaAI = function() {
        document.querySelectorAll('textarea').forEach(t => {
            t.classList.add('google-ai-rotate');
            
            // Berhenti berpusing selepas 1.5 saat (1.5 pusingan)
            setTimeout(() => {
                t.classList.remove('google-ai-rotate');
                // Kekalkan glow lembut sekejap sebelum hilang sepenuhnya
                t.style.boxShadow = '0 0 10px rgba(66, 133, 244, 0.3)';
                setTimeout(() => t.style.boxShadow = 'none', 500);
            }, 1500);
        });
    };

    // 1. Jalankan bila blog mula-mula dibuka (Entrance)
    window.addEventListener('load', pusingWarnaAI);

    // 2. Jalankan bila user klik kotak (Fokus pertama kali)
    document.querySelectorAll('textarea').forEach(t => {
        t.addEventListener('focus', function() {
            if (!this.classList.contains('google-ai-rotate')) {
                this.classList.add('google-ai-rotate');
                setTimeout(() => this.classList.remove('google-ai-rotate'), 1200);
            }
        });
    });
})();

document.querySelectorAll('.card').forEach((c, i) => {
    c.style.opacity = '0';
    c.style.transform = 'translateY(20px)';
    c.style.transition = 'all 0.6s ease ' + (i * 0.2) + 's';
    window.addEventListener('load', () => {
        c.style.opacity = '1';
        c.style.transform = 'translateY(0)';
    });
});

document.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', (e) => {
        for(let i=0; i<5; i++) {
            const p = document.createElement('div');
            const colors = ['#4285F4', '#EA4335', '#FBBC05', '#34A853'];
            p.style = `position:fixed; width:4px; height:4px; border-radius:50%; background:${colors[i%4]}; left:${e.clientX}px; top:${e.clientY}px; z-index:9999;`;
            document.body.appendChild(p);
            p.animate([{transform:'translate(0,0)', opacity:1}, {transform:`translate(${(Math.random()-0.5)*50}px, ${(Math.random()-0.5)*50}px)`, opacity:0}], 600);
            setTimeout(() => p.remove(), 600);
        }
    });
});
