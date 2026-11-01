(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- toast ---------- */
  var toastEl = $('#toast'), toastTimer;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('is-on'); }, 2200);
  }

  /* ---------- emoji burst ---------- */
  var BURST = ['💗', '🧸', '🎀', '✨', '💕', '🌷', '⭐'];
  function burst(x, y, n) {
    if (reduceMotion) return;
    for (var i = 0; i < (n || 14); i++) {
      var el = document.createElement('span');
      var ang = Math.random() * Math.PI * 2, dist = 60 + Math.random() * 110;
      el.className = 'burst';
      el.textContent = BURST[Math.floor(Math.random() * BURST.length)];
      el.style.left = x + 'px';
      el.style.top = y + 'px';
      el.style.setProperty('--dx', Math.cos(ang) * dist + 'px');
      el.style.setProperty('--dy', Math.sin(ang) * dist - 40 + 'px');
      el.style.setProperty('--rot', (Math.random() * 120 - 60) + 'deg');
      el.style.animationDelay = Math.random() * 0.12 + 's';
      document.body.appendChild(el);
      setTimeout(el.remove.bind(el), 1500);
    }
  }

  /* ---------- theme ---------- */
  var root = document.documentElement;
  var themeBtn = $('#theme-toggle');
  function isDark() {
    var t = root.getAttribute('data-theme');
    if (t) return t === 'dark';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  function syncThemeIcon() {
    themeBtn.innerHTML = isDark() ? '<i class="fa-solid fa-sun"></i>' : '<i class="fa-solid fa-moon"></i>';
  }
  themeBtn.addEventListener('click', function () {
    var next = isDark() ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
    syncThemeIcon();
    toast(next === 'dark' ? '🌙 Good night mode' : '☀️ Good morning mode');
  });
  syncThemeIcon();

  /* ---------- nav: burger, active section, hide on scroll ---------- */
  var nav = $('.topnav'), burger = $('#nav-burger'), links = $('#nav-links');
  burger.addEventListener('click', function () {
    var open = links.classList.toggle('is-open');
    burger.setAttribute('aria-expanded', open);
    burger.innerHTML = open ? '<i class="fa-solid fa-xmark"></i>' : '<i class="fa-solid fa-bars"></i>';
  });
  $$('a', links).forEach(function (a) {
    a.addEventListener('click', function () {
      links.classList.remove('is-open');
      burger.setAttribute('aria-expanded', 'false');
      burger.innerHTML = '<i class="fa-solid fa-bars"></i>';
    });
  });

  var progress = $('.scroll-progress'), lastY = window.scrollY, ticking = false;
  function onScroll() {
    var y = window.scrollY, max = document.documentElement.scrollHeight - window.innerHeight;
    progress.style.transform = 'scaleX(' + (max > 0 ? y / max : 0) + ')';
    var goingDown = y > lastY + 4, goingUp = y < lastY - 4;
    if (goingDown && y > 400 && !links.classList.contains('is-open')) nav.classList.add('is-hidden');
    else if (goingUp || y < 200) nav.classList.remove('is-hidden');
    lastY = y;
    ticking = false;
  }
  window.addEventListener('scroll', function () {
    if (!ticking) { requestAnimationFrame(onScroll); ticking = true; }
  }, { passive: true });

  var navMap = {};
  $$('a', links).forEach(function (a) { navMap[a.getAttribute('href').slice(1)] = a; });
  var spy = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      $$('a', links).forEach(function (a) { a.classList.remove('is-active'); });
      if (navMap[e.target.id]) navMap[e.target.id].classList.add('is-active');
    });
  }, { rootMargin: '-45% 0px -50% 0px' });
  Object.keys(navMap).forEach(function (id) { var s = document.getElementById(id); if (s) spy.observe(s); });

  /* ---------- section heading stickers ---------- */
  var H2_EMOJI = { about: '🌷', research: '🔭', news: '📰', publications: '📚', services: '🤝', misc: '🎀' };
  Object.keys(H2_EMOJI).forEach(function (id) {
    var h = $('#' + id + ' h2');
    if (h) h.setAttribute('data-emoji', H2_EMOJI[id]);
  });

  /* ---------- typewriter ---------- */
  var typer = $('.typer');
  if (typer && !reduceMotion) {
    var words = typer.getAttribute('data-words').split('|'), wi = 0, ci = words[0].length, deleting = true;
    setTimeout(function tick() {
      var w = words[wi];
      if (deleting) {
        ci--;
        if (ci <= 0) { deleting = false; wi = (wi + 1) % words.length; }
      } else {
        ci++;
      }
      typer.textContent = words[wi].slice(0, Math.max(ci, 0));
      var delay = deleting ? 35 : 70;
      if (!deleting && ci >= words[wi].length) { deleting = true; delay = 2200; }
      setTimeout(tick, delay);
    }, 2400);
  }

  /* ---------- email copy ---------- */
  var emailBtn = $('.email-link');
  if (emailBtn) {
    emailBtn.addEventListener('click', function (ev) {
      var addr = emailBtn.getAttribute('data-email');
      var done = function () { toast('💌 Copied ' + addr); burst(ev.clientX, ev.clientY, 8); };
      if (navigator.clipboard) navigator.clipboard.writeText(addr).then(done, function () { location.href = 'mailto:' + addr; });
      else location.href = 'mailto:' + addr;
    });
  }

  /* ---------- avatar easter egg ---------- */
  var avatar = $('#avatar'), avatarClicks = 0;
  var HELLOS = ['안녕하세요! 👋', 'Hi, I\'m Dana! 🧸', 'Let\'s collaborate 💗', 'Sanrio fan club 🎀'];
  if (avatar) {
    avatar.addEventListener('click', function (ev) {
      burst(ev.clientX, ev.clientY, 18);
      toast(HELLOS[avatarClicks++ % HELLOS.length]);
    });
  }

  /* ---------- vision scene: sense -> reason -> act ---------- */
  var scene = $('.scene'), steps = $$('.scene-steps .step'), STEPS = ['sense', 'reason', 'act'];
  if (scene) {
    var stepIdx = 0, autoTimer = null, userTouched = false, visible = false;

    var setStep = function (name) {
      stepIdx = STEPS.indexOf(name);
      scene.setAttribute('data-step', name);
      steps.forEach(function (st) {
        var on = st.getAttribute('data-step') === name;
        st.classList.toggle('is-active', on);
        $('.step-head', st).setAttribute('aria-selected', on);
      });
    };
    var stopAuto = function () { clearInterval(autoTimer); autoTimer = null; };
    var startAuto = function () {
      stopAuto();
      if (reduceMotion || userTouched || !visible) return;
      autoTimer = setInterval(function () {
        if (stepIdx === STEPS.length - 1) { stopAuto(); return; }
        setStep(STEPS[stepIdx + 1]);
      }, 5200);
    };

    steps.forEach(function (st) {
      $('.step-head', st).addEventListener('click', function () {
        userTouched = true;
        stopAuto();
        setStep(st.getAttribute('data-step'));
      });
    });
    $('.replay').addEventListener('click', function () {
      userTouched = false;
      setStep('sense');
      startAuto();
    });

    $$('.sensor-toggle').forEach(function (b) {
      b.addEventListener('click', function () {
        userTouched = true;
        stopAuto();
        var on = b.classList.toggle('is-on');
        b.setAttribute('aria-pressed', on);
        scene.classList.toggle('off-' + b.getAttribute('data-layer'), !on);
      });
    });

    new IntersectionObserver(function (entries) {
      visible = entries[0].isIntersecting;
      if (visible) startAuto(); else stopAuto();
    }, { threshold: 0.5 }).observe(scene);

    // Upgrade to the interactive WebGL kitchen when the section gets close.
    if (window.WebGLRenderingContext && scene.querySelector('.scene-3d')) {
      var io3d = new IntersectionObserver(function (entries) {
        if (!entries[0].isIntersecting) return;
        io3d.disconnect();
        import('./scene3d.js')
          .then(function (m) { return m.initScene(scene); })
          .catch(function (err) { console.warn('3D scene unavailable, keeping the illustration.', err); });
      }, { rootMargin: '600px 0px' });
      io3d.observe(scene);
    }

    // Gentle 3D tilt that follows the pointer.
    var tilt = $('.scene-tilt');
    if (!reduceMotion) {
      scene.addEventListener('pointermove', function (e) {
        var r = scene.getBoundingClientRect();
        var nx = (e.clientX - r.left) / r.width - 0.5, ny = (e.clientY - r.top) / r.height - 0.5;
        tilt.style.transform = 'rotateX(' + (-ny * 8).toFixed(2) + 'deg) rotateY(' + (nx * 10).toFixed(2) + 'deg)';
      });
      scene.addEventListener('pointerleave', function () { tilt.style.transform = ''; });
    }
  }

  /* ---------- news: year filter + collapse ---------- */
  var timeline = $('.timeline');
  if (timeline) {
    var rows = Array.prototype.slice.call(timeline.children), years = [], current = null;
    rows.forEach(function (r) {
      if (r.classList.contains('timeline-year')) {
        current = r.textContent.trim();
        years.push(current);
      }
      r.setAttribute('data-year', current);
    });

    var SHOW_N = 8;
    var bar = document.createElement('div');
    bar.className = 'news-filters';
    bar.setAttribute('role', 'toolbar');
    bar.innerHTML = '<button class="chip is-active" data-year="all">All</button>' +
      years.map(function (y) { return '<button class="chip" data-year="' + y + '">' + y + '</button>'; }).join('');
    timeline.parentNode.insertBefore(bar, timeline);

    var more = document.createElement('button');
    more.className = 'chip news-more';
    timeline.parentNode.insertBefore(more, timeline.nextSibling);
    var expanded = false;

    var applyNews = function (year) {
      var shown = 0;
      rows.forEach(function (r) {
        var match = year === 'all' || r.getAttribute('data-year') === year;
        r.classList.toggle('is-filtered', !match);
        var isItem = r.classList.contains('timeline-item');
        if (isItem && match) shown++;
        r.classList.toggle('is-collapsed', year === 'all' && !expanded && shown > SHOW_N && match);
      });
      // Hide a year label whose items are all collapsed.
      rows.forEach(function (r, i) {
        if (!r.classList.contains('timeline-year')) return;
        var next = rows[i + 1];
        if (next && next.classList.contains('is-collapsed')) r.classList.add('is-collapsed');
      });
      var hidden = rows.filter(function (r) { return r.classList.contains('timeline-item') && r.classList.contains('is-collapsed'); }).length;
      more.hidden = year !== 'all';
      more.textContent = expanded ? '↑ Show less' : '↓ Show ' + hidden + ' older updates';
    };

    bar.addEventListener('click', function (ev) {
      var b = ev.target.closest('.chip');
      if (!b) return;
      $$('.chip', bar).forEach(function (c) { c.classList.toggle('is-active', c === b); });
      applyNews(b.getAttribute('data-year'));
    });
    more.addEventListener('click', function () {
      expanded = !expanded;
      applyNews('all');
      if (!expanded) $('#news').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' });
    });
    applyNews('all');
  }

  /* ---------- publications filter ---------- */
  var pubBar = $('.pub-filters'), cards = $$('.pub-card'), empty = $('.pub-empty');
  if (pubBar) {
    pubBar.addEventListener('click', function (ev) {
      var b = ev.target.closest('.chip');
      if (!b) return;
      var f = b.getAttribute('data-filter'), n = 0;
      $$('.chip', pubBar).forEach(function (c) { c.classList.toggle('is-active', c === b); });
      cards.forEach(function (c) {
        var themes = (c.getAttribute('data-themes') || '').split(/\s+/);
        var ok = f === 'all' || themes.indexOf(f) !== -1;
        c.classList.toggle('is-hidden', !ok);
        if (ok) n++;
      });
      if (empty) empty.hidden = n > 0;
    });
  }
})();
