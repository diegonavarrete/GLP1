import re

with open('index_3.html', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Update quiz input row
content = content.replace(
'''    .quiz-input-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
      margin-bottom: 16px;
    }''',
'''    .quiz-input-row {
      display: grid;
      grid-template-columns: 1fr;
      gap: 12px;
      margin-bottom: 16px;
    }
    @media (min-width: 480px) {
      .quiz-input-row { grid-template-columns: 1fr 1fr; }
    }'''
)

# 2. Update hero meta
content = content.replace(
'''    .hero-meta {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 12px;
      margin-top: 28px;
      padding-top: 24px;
      border-top: 1px solid var(--line);
    }''',
'''    .hero-meta {
      display: grid;
      grid-template-columns: 1fr;
      gap: 16px;
      margin-top: 28px;
      padding-top: 24px;
      border-top: 1px solid var(--line);
    }
    @media (min-width: 768px) {
      .hero-meta {
        grid-template-columns: repeat(3, 1fr);
        gap: 12px;
      }
    }'''
)

# 3. Mobile menu
css_to_add = '''
    .menu-toggle {
      display: none;
      background: none;
      border: none;
      color: var(--ink);
      padding: 4px;
      cursor: pointer;
    }
    .menu-toggle svg {
      transition: transform 0.3s ease;
    }
    @media (max-width: 820px) {
      .menu-toggle { display: block; }
      .nav-links {
        position: absolute;
        top: 100%;
        left: 0;
        right: 0;
        background: rgba(245, 241, 234, 0.98);
        backdrop-filter: blur(16px);
        -webkit-backdrop-filter: blur(16px);
        flex-direction: column;
        padding: 24px var(--gutter);
        border-bottom: 1px solid var(--line-soft);
        gap: 20px;
        transform: translateY(-10px);
        opacity: 0;
        pointer-events: none;
        transition: all .4s cubic-bezier(0.16, 1, 0.3, 1);
        box-shadow: 0 10px 30px rgba(0,0,0,0.05);
      }
      .nav-links.is-open {
        transform: translateY(0);
        opacity: 1;
        pointer-events: auto;
      }
      .nav-links a:not(.btn-nav) {
        display: block !important;
        font-size: 18px !important;
        padding: 8px 0;
        border-bottom: 1px solid var(--line-soft);
      }
      .nav-links a:not(.btn-nav):last-of-type {
        border-bottom: none;
      }
      .btn-nav {
        text-align: center;
        width: 100%;
        padding: 16px !important;
        font-size: 16px !important;
        margin-top: 8px;
      }
    }
'''
content = content.replace('    /* HERO */', css_to_add + '    /* HERO */')

html_to_replace = '''      <div class="nav-links">
        <a href="#como-funciona">Cómo funciona</a>
        <a href="#planes">Planes</a>
        <a href="#medicos">Médicos</a>
        <a href="#faq">Preguntas</a>
        <a href="#evaluacion" class="btn-nav">Comenzar</a>
      </div>'''

html_replacement = '''      <div class="nav-links" id="nav-links">
        <a href="#como-funciona" onclick="toggleMenu()">Cómo funciona</a>
        <a href="#planes" onclick="toggleMenu()">Planes</a>
        <a href="#medicos" onclick="toggleMenu()">Médicos</a>
        <a href="#faq" onclick="toggleMenu()">Preguntas</a>
        <a href="#evaluacion" class="btn-nav" onclick="toggleMenu()">Comenzar</a>
      </div>
      <button class="menu-toggle" onclick="toggleMenu()" aria-label="Menu">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" id="menu-icon"><path d="M3 12h18M3 6h18M3 18h18"/></svg>
      </button>'''
content = content.replace(html_to_replace, html_replacement)

content = content.replace('''    @media (max-width: 820px) {
      .nav-links a:not(.btn-nav) { display: none; }
    }''', '')

js_to_add = '''
    function toggleMenu() {
      const links = document.getElementById('nav-links');
      links.classList.toggle('is-open');
      const icon = document.querySelector('#menu-icon path');
      if (links.classList.contains('is-open')) {
        icon.setAttribute('d', 'M18 6L6 18M6 6l12 12');
      } else {
        icon.setAttribute('d', 'M3 12h18M3 6h18M3 18h18');
      }
    }
'''
content = content.replace('<script>', '<script>' + js_to_add)

# Premium Buttons
content = content.replace('''    .btn-primary {
      display: inline-flex;''', '''    .btn-primary {
      display: inline-flex;
      position: relative;
      overflow: hidden;
      box-shadow: 0 4px 14px rgba(15,39,34,0.15);''')

content = content.replace('''    .btn-primary:hover { background: var(--rust); }''', '''    .btn-primary::after {
      content: ""; position: absolute; inset: 0; background: linear-gradient(120deg, transparent, rgba(255,255,255,0.2), transparent); transform: translateX(-100%); transition: transform 0.6s;
    }
    .btn-primary:hover::after { transform: translateX(100%); }
    .btn-primary:hover { background: var(--rust); box-shadow: 0 6px 20px rgba(196,69,54,0.3); transform: translateY(-1px); }''')

# Floating WhatsApp Animation
content = content.replace('''    .float-cta {
      position: fixed;''', '''    @keyframes pulse-wa {
      0% { box-shadow: 0 0 0 0 rgba(37, 211, 102, 0.4); }
      70% { box-shadow: 0 0 0 15px rgba(37, 211, 102, 0); }
      100% { box-shadow: 0 0 0 0 rgba(37, 211, 102, 0); }
    }
    .float-cta {
      position: fixed;
      animation: pulse-wa 2s infinite;''')

# Add Ambient Glows for luxury feel
glow_css = '''
    .ambient-glow {
      position: fixed;
      width: 600px;
      height: 600px;
      border-radius: 50%;
      filter: blur(120px);
      pointer-events: none;
      z-index: -2;
      opacity: 0.6;
    }
    .glow-1 {
      top: -200px;
      left: -200px;
      background: rgba(107, 132, 114, 0.15);
    }
    .glow-2 {
      bottom: -100px;
      right: -100px;
      background: rgba(196, 69, 54, 0.1);
    }
'''
content = content.replace('    /* RESET */', glow_css + '    /* RESET */')
content = content.replace('<body>', '<body>\n  <div class="ambient-glow glow-1"></div>\n  <div class="ambient-glow glow-2"></div>')

# Improved Steps mobile
content = content.replace(
'''    .steps {
      display: grid;
      grid-template-columns: 1fr;
      gap: 1px;
      background: var(--line);
      border-radius: 20px;
      overflow: hidden;
      border: 1px solid var(--line);
    }''',
'''    .steps {
      display: grid;
      grid-template-columns: 1fr;
      gap: 16px;
      background: transparent;
      border-radius: 0;
      border: none;
      overflow: visible;
    }
    @media (min-width: 820px) {
      .steps {
        grid-template-columns: repeat(3, 1fr);
        gap: 1px;
        background: var(--line);
        border-radius: 24px;
        border: 1px solid var(--line);
        overflow: hidden;
      }
    }'''
)
content = content.replace(
'''    .step {
      background: var(--paper);
      padding: 28px 24px;
      transition: background .3s ease;
    }''',
'''    .step {
      background: var(--paper);
      padding: 28px 24px;
      transition: background .3s ease, transform .3s ease, box-shadow .3s ease;
      border-radius: 20px;
      border: 1px solid var(--line);
    }
    @media (min-width: 820px) {
      .step {
        border-radius: 0;
        border: none;
      }
    }
    .step:hover {
      background: var(--cream-warm);
      transform: translateY(-4px);
      box-shadow: 0 12px 32px -16px rgba(15, 39, 34, 0.15);
    }'''
)

with open('index_3.html', 'w', encoding='utf-8') as f:
    f.write(content)

print("done")
