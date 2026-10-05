/**
 * dsh-promptimizer — client half.
 *
 * MODULE FORMAT: served inside the DSH client combo bundle and executed as a
 * CLASSIC SCRIPT via window.__ModuleLoader__.load (same as every upstream
 * client bundle). No ESM import/export statements here.
 *
 * What it does: a ✨ Optimize button + strength selector LEFT of the model
 * selector in the composer. One click sends the current prompt to an
 * OpenAI-compatible endpoint (DEFAULT: the currently selected model at
 * api.deepseek.com — configure any provider via right-click) and replaces
 * the prompt with a professionally restructured version:
 *   Light    keep the user's wording, make the deliverable explicit
 *   Standard restructure into 任務/要求/驗收 (task/requirements/acceptance)
 *   Deep     full engineering spec (role/deliverables/constraints/edges/DoD)
 *
 * SOFT-FAIL CONTRACT: every feature is isolated; a failure degrades to
 * "official look" or the offline rule-based rewriter — never a broken app.
 *
 * Verified internals (DSH 0.2.0-rc.2, Lexical composer):
 *  - style adoption copies the model selector's computed metrics at mount
 *  - replace recipe: real focus prologue -> settle -> Range covering all
 *    contents -> settle -> synthetic paste (preserves newlines, persists)
 *  - model id parsed from the selector's aria-label ("current <model>, ...")
 */
window.__ModuleLoader__.load({
  id: "dsh-promptimizer",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    const TAG = '[promptimizer]';
    const ACCENT = '#4F46E5';
    const DEFAULT_URL = 'https://api.deepseek.com/v1';
    const LS = { url: 'promptimizer-url', key: 'promptimizer-key', strength: 'promptimizer-strength', lang: 'promptimizer-lang' };

    /** Display names (as shown by the DSH model selector) -> provider ids. */
    const MODEL_MAP = {
      'deepseek-v41-flash': 'deepseek-flash',
      'deepseek-flash': 'deepseek-flash',
      'deepseek-v4-pro': 'deepseek-v4-pro',
      'deepseek-v41-pro': 'deepseek-v4-pro',
      'deepseek-chat': 'deepseek-chat',
      'deepseek-reasoner': 'deepseek-reasoner',
    };

    // ── i18n: zh/en by system language (localStorage override) ─────────────
    const LANG = (() => {
      try { const o = localStorage.getItem(LS.lang); if (o === 'zh' || o === 'en') return o; } catch (e) { /* noop */ }
      return /^zh/i.test((navigator && navigator.language) || '') ? 'zh' : 'en';
    })();
    const STR = {
      zh: {
        optLabel: '優化', optimizing: '優化中…', done: '✅ 已優化·', restored: '已還原原文',
        offline: '⚠️ 離線·規則改寫', cancelled: '已取消',
        tipOpt: '提示詞優化（用當前選中的模型）；已優化時再點還原；右鍵設定端點與金鑰',
        strengthTitle: '優化強度', strengthTip: '優化強度（點擊調整）',
        light: '輕度', standard: '標準', deep: '深度',
        lightDesc: '保留原話，補交付物', stdDesc: '任務・要求・驗收', deepDesc: '完整工程規格',
        undo: '↩︎ 還原原文', keyMenu: '🔑 端點與金鑰設定',
        urlPrompt: 'OpenAI 相容端點（例 https://api.deepseek.com/v1）：',
        keyPrompt: 'API key（保存於本機 localStorage）：',
        charsUnit: '字',
      },
      en: {
        optLabel: 'Optimize', optimizing: 'Optimizing…', done: '✅ Optimized·', restored: 'Restored original',
        offline: '⚠️ Offline·rule-based', cancelled: 'Cancelled',
        tipOpt: 'Optimize prompt (current model); click again to restore; right-click to configure',
        strengthTitle: 'Strength', strengthTip: 'Optimize strength',
        light: 'Light', standard: 'Standard', deep: 'Deep',
        lightDesc: 'Keep wording, add deliverable', stdDesc: 'Task/Requirements/Acceptance', deepDesc: 'Full engineering spec',
        undo: '↩︎ Restore original', keyMenu: '🔑 Endpoint & key settings',
        urlPrompt: 'OpenAI-compatible endpoint (e.g. https://api.deepseek.com/v1):',
        keyPrompt: 'API key (stored in local localStorage):',
        charsUnit: 'chars',
      },
    };
    const T = (k) => (STR[LANG] && STR[LANG][k]) || STR.zh[k] || k;

    const SELECTORS = {
      modelSlot: '[data-slot="conversation.input.model"]',
      composerBar: '[data-slot="conversation.composer.bar"]',
      heroTitle: '[data-slot="conversation.hero"] , [class*="heroTitle"]',
    };

    function lsGet(k, dflt) { try { return localStorage.getItem(k) || dflt; } catch (e) { return dflt; } }
    function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* noop */ } }

    /** Read the CURRENT model from the model selector's aria-label. */
    function currentModel() {
      try {
        const slot = document.querySelector(SELECTORS.modelSlot);
        const btn = slot && slot.querySelector('button[aria-label], [role="button"][aria-label]');
        const m = btn && btn.getAttribute('aria-label').match(/current ([^,]+)/i);
        const name = (m && m[1] || '').trim();
        if (name) return name;
      } catch (e) { /* fall through */ }
      return 'deepseek-chat';
    }
    function modelIdFor(display) {
      const key = String(display || '').trim().toLowerCase();
      return MODEL_MAP[key] || key || 'deepseek-chat';
    }

    // ── editor driver (verified against the Lexical composer) ──────────────
    function editorEl() { return document.querySelector('[contenteditable="true"]'); }
    function editorText() { const ed = editorEl(); return ed ? (ed.textContent || '') : ''; }
    const pause = (ms) => new Promise((res) => setTimeout(res, ms));

    function pasteIntoEditor(text) {
      const ed = editorEl();
      if (!ed) return false;
      ed.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      ed.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      ed.focus();
      setTimeout(() => {
        const range = document.createRange();
        range.selectNodeContents(ed);
        range.collapse(false); // caret to end
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        const dt = new DataTransfer();
        dt.setData('text/plain', String(text));
        ed.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      }, 60);
      return true;
    }

    async function setEditorText(text) {
      const ed = editorEl();
      if (!ed) return false;
      // real focus prologue keeps Lexical's selection model in sync; Range
      // covering ALL contents + paste replaces fully AND keeps newlines
      ed.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      ed.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      ed.focus();
      await pause(80);
      const range = document.createRange();
      range.selectNodeContents(ed);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      await pause(50);
      const dt = new DataTransfer();
      dt.setData('text/plain', String(text));
      ed.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      return true;
    }

    // ── optimizer ───────────────────────────────────────────────────────────
    const Promptimizer = {
      lastOriginal: null,
      lastOptimized: null,
      strength: 3,
      _working: false,
      _abort: null,
      _t0: 0,
      _statusTimer: null,

      endpoint() { return lsGet(LS.url, '') || DEFAULT_URL; },
      apiKey() { return lsGet(LS.key, ''); },

      systemFor(level) {
        const base = '[DSH-PROMPTIMIZER] level=' + level + ' ';
        if (level === 1) return base + 'You lightly improve the user prompt: keep their wording, only clarify ambiguity and make the deliverable explicit. Reply with the improved prompt ONLY, in the user language, no commentary.';
        if (level === 2) return base + 'You restructure the user prompt into 任務/要求/驗收 (task/requirements/acceptance) sections, enrich constraints with proven engineering practices. Reply with the improved prompt ONLY, in the user language.';
        return base + 'You deeply engineer the user prompt into a professional spec: role, task, deliverables, constraints, edge cases, acceptance criteria. Reply with the improved prompt ONLY, in the user language.';
      },

      /** Streaming completion against any OpenAI-compatible endpoint. */
      async callModel(level, text, model) {
        const url = this.endpoint().replace(/\/$/, '') + '/chat/completions';
        this._abort = new AbortController();
        const res = await fetch(url, {
          method: 'POST',
          signal: this._abort.signal,
          headers: { 'content-type': 'application/json', authorization: 'Bearer ' + this.apiKey() },
          body: JSON.stringify({
            model: modelIdFor(model),
            stream: true,
            messages: [
              { role: 'system', content: this.systemFor(level) },
              { role: 'user', content: text },
            ],
          }),
        });
        if (!res.ok) throw new Error('endpoint ' + res.status);
        if (!res.body) {
          const data = await res.json();
          return String((data.choices || [{}])[0].message?.content ?? '').trim();
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '', out = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop() || '';
          for (const line of lines) {
            const t = line.trim();
            if (!t.startsWith('data:')) continue;
            const payload = t.slice(5).trim();
            if (payload === '[DONE]') continue;
            try {
              const d = JSON.parse(payload);
              const delta = d.choices && d.choices[0] && d.choices[0].delta && d.choices[0].delta.content;
              if (delta) out += delta;
            } catch (e) { /* partial line */ }
          }
        }
        if (!out.trim()) throw new Error('empty completion');
        return out.trim();
      },
      cancel() { if (this._abort) { try { this._abort.abort(); } catch (e) { /* noop */ } } },

      /** Offline fallback: deterministic rule-based restructure. */
      enhance(text) {
        const t = text.trim();
        const out = ['【任務】' + t];
        if (!/(給我|給|做|寫|實現|实现|開發|开发|分析|修復|修复|設計|设计|調研|调研|整理|生成|審查|审查|優化|优化|build|make|write|create|fix|design)/i.test(t)) {
          out.push('【輸出】請明確交付物的形式與格式');
        }
        out.push('【要求】先理解再動手；關鍵決策列出選項與理由；遵循現有風格，最小變更');
        out.push('【驗收】完成後自檢一輪，並說明如何驗證');
        return out.join('\n');
      },

      setStatus(text, sticky) {
        const btn = document.getElementById('pmz-opt');
        if (!btn) return;
        btn.title = text;
        const label = btn.querySelector('b');
        if (label && !sticky) {
          label.textContent = text.length > 8 ? text.slice(0, 8) : text;
          clearTimeout(this._statusTimer);
          this._statusTimer = setTimeout(() => { label.textContent = T('optLabel'); }, 2500);
        }
      },
      setActive(on) {
        const btn = document.getElementById('pmz-opt');
        if (btn) btn.classList.toggle('active', on);
      },

      async run() {
        if (this._working) return;
        const text = editorText();
        if (!text.trim()) {
          pasteIntoEditor('【任務】我想___\n【輸出】___\n【驗收】___');
          return;
        }
        if (this.lastOptimized !== null && text === this.lastOptimized && this.lastOriginal !== null) {
          await setEditorText(this.lastOriginal);
          this.lastOriginal = null; this.lastOptimized = null;
          this.setActive(false);
          this.setStatus(T('restored'));
          return;
        }
        const btn = document.getElementById('pmz-opt');
        const model = currentModel();
        this._working = true; this._t0 = Date.now();
        if (btn) { btn.classList.add('working'); btn.querySelector('b').textContent = T('optimizing'); }
        let result = null, offline = false, cancelled = false;
        try { result = await this.callModel(this.strength, text, model); }
        catch (e) {
          if (e && e.name === 'AbortError') cancelled = true;
          else { offline = true; result = this.enhance(text); }
        }
        this._working = false;
        if (btn) { btn.classList.remove('working'); btn.querySelector('b').textContent = T('optLabel'); }
        if (cancelled) { this.setStatus(T('cancelled')); return; }
        const secs = Math.round((Date.now() - this._t0) / 1000);
        this.lastOriginal = text;
        this.lastOptimized = result;
        await setEditorText(result);
        this.setActive(true);
        this.setStatus(offline ? T('offline') : `${T('done')}${model}·${result.length}${T('charsUnit')}·${secs}s`);
      },

      /** Copy the model selector's computed style onto our controls. */
      adoptModelStyle(el) {
        try {
          const slot = document.querySelector(SELECTORS.modelSlot);
          const ref = slot && slot.querySelector('button[aria-label]');
          if (!ref) return;
          const cs = getComputedStyle(ref);
          for (const prop of ['font-size', 'font-weight', 'line-height', 'height', 'padding-left', 'padding-right',
            'border-radius', 'color', 'gap', 'letter-spacing']) {
            el.style.setProperty(prop, cs.getPropertyValue(prop));
          }
          el.style.display = 'flex';
          el.style.alignItems = 'center';
          el.style.background = 'transparent';
          el.style.border = 'none';
        } catch (e) { /* keep default look */ }
      },
      strengthName(n) { return n === 1 ? T('light') : n === 3 ? T('deep') : T('standard'); },

      buildStrengthMenu() {
        const menu = document.createElement('div');
        menu.id = 'pmz-strength-menu';
        const levels = [[1, 'light', 'lightDesc'], [2, 'standard', 'stdDesc'], [3, 'deep', 'deepDesc']];
        menu.innerHTML =
          '<div class="pmz-sm-title"></div>' +
          levels.map(([n]) => `<div class="it" data-level="${n}"><span></span><small></small></div>`).join('') +
          '<div class="sep"></div>' +
          '<div class="it" data-act="undo" style="display:none"><span>↩︎</span><span></span></div>' +
          '<div class="it" data-act="cfg"><span>🔑</span><span></span></div>';
        menu.querySelector('.pmz-sm-title').textContent = T('strengthTitle');
        menu.querySelectorAll('[data-level]').forEach((it) => {
          const n = parseInt(it.getAttribute('data-level'), 10);
          it.querySelector('span').textContent = this.strengthName(n);
          it.querySelector('small').textContent = T(['lightDesc', 'stdDesc', 'deepDesc'][n - 1]);
          if (n === this.strength) it.classList.add('cur');
          it.onclick = () => {
            this.strength = n;
            lsSet(LS.strength, String(n));
            this.refreshStrengthPill();
            menu.remove();
          };
        });
        menu.querySelector('[data-act="undo"] span:last-child').textContent = T('undo');
        menu.querySelector('[data-act="undo"]').onclick = async () => {
          if (this.lastOriginal !== null) {
            await setEditorText(this.lastOriginal);
            this.lastOriginal = null; this.lastOptimized = null;
            this.setActive(false);
            this.setStatus(T('restored'));
          }
          menu.remove();
        };
        menu.querySelector('[data-act="cfg"] span:last-child').textContent = T('keyMenu');
        menu.querySelector('[data-act="cfg"]').onclick = () => { Promptimizer.configure(); menu.remove(); };
        menu.addEventListener('click', (e) => e.stopPropagation());
        return menu;
      },
      configure() {
        const url = window.prompt(T('urlPrompt'), lsGet(LS.url, ''));
        if (url !== null) lsSet(LS.url, url.trim());
        const key = window.prompt(T('keyPrompt'), this.apiKey());
        if (key !== null) lsSet(LS.key, key.trim());
      },
      refreshStrengthPill() {
        const pill = document.getElementById('pmz-strength');
        if (!pill) return;
        pill.querySelector('b').textContent = this.strengthName(this.strength);
        pill.title = T('strengthTip');
      },

      injectStylesheet() {
        if (document.getElementById('pmz-style')) return;
        const style = document.createElement('style');
        style.id = 'pmz-style';
        style.textContent = `
          :root { --pmz-accent: ${ACCENT}; }
          .pmz-ctl { cursor: pointer; user-select: none; }
          .pmz-ctl:hover { background: color-mix(in srgb, CanvasText 7%, transparent) !important; }
          .pmz-ctl.active { color: var(--pmz-accent) !important; }
          .pmz-ctl.working { animation: pmz-pulse 1.6s ease-in-out infinite; color: var(--pmz-accent) !important; }
          @keyframes pmz-pulse { 0%, 100% { opacity: 1; } 50% { opacity: .35; } }
          #pmz-strength-menu { position: fixed; z-index: 1200; width: 240px; padding: 5px;
            background: color-mix(in srgb, var(--pmz-accent) 4%, Canvas); color: CanvasText;
            border: 1px solid color-mix(in srgb, var(--pmz-accent) 30%, transparent);
            border-radius: 11px; box-shadow: 0 10px 28px rgba(0,0,0,.2); font-size: 12.5px; }
          #pmz-strength-menu .pmz-sm-title { font-weight: 700; padding: 5px 9px 7px; font-size: 12px; opacity: .8; }
          #pmz-strength-menu .it { display: flex; align-items: center; gap: 6px; padding: 6px 9px;
            border-radius: 7px; cursor: pointer; }
          #pmz-strength-menu .it:hover { background: color-mix(in srgb, var(--pmz-accent) 12%, transparent); }
          #pmz-strength-menu .it small { opacity: .5; margin-left: auto; font-size: 10px; }
          #pmz-strength-menu .it.cur { background: color-mix(in srgb, var(--pmz-accent) 16%, transparent); }
          #pmz-strength-menu .sep { height: 1px; margin: 3px 8px; background: color-mix(in srgb, CanvasText 12%, transparent); }
        `;
        document.head.appendChild(style);
      },

      mount() {
        const slot = document.querySelector(SELECTORS.modelSlot);
        if (!slot) return;
        if (document.getElementById('pmz-opt')) return;
        this.strength = parseInt(lsGet(LS.strength, '3'), 10) || 3;

        const btn = document.createElement('button');
        btn.id = 'pmz-opt'; btn.type = 'button'; btn.className = 'pmz-ctl';
        btn.innerHTML = '✨ <b></b>';
        btn.querySelector('b').textContent = T('optLabel');
        btn.title = T('tipOpt');
        this.adoptModelStyle(btn);
        btn.onclick = async (e) => { e.stopPropagation(); try { await this.run(); } catch (err) { console.warn(TAG, 'failed:', err); } };
        btn.oncontextmenu = (e) => { e.preventDefault(); e.stopPropagation(); this.configure(); };

        const pill = document.createElement('button');
        pill.id = 'pmz-strength'; pill.type = 'button'; pill.className = 'pmz-ctl';
        pill.innerHTML = '<b></b><span style="font-size:9px;opacity:.55">▾</span>';
        this.adoptModelStyle(pill);
        pill.onclick = (e) => {
          e.stopPropagation();
          const existing = document.getElementById('pmz-strength-menu');
          if (existing) { existing.remove(); return; }
          const menu = this.buildStrengthMenu();
          const undo = menu.querySelector('[data-act="undo"]');
          if (undo) undo.style.display = (this.lastOriginal !== null) ? '' : 'none';
          document.body.appendChild(menu);
          const rect = pill.getBoundingClientRect();
          menu.style.left = Math.max(8, Math.min(window.innerWidth - 240, rect.left)) + 'px';
          menu.style.top = (rect.bottom + 6) + 'px';
          const close = (ev) => {
            if (!menu.contains(ev.target) && !pill.contains(ev.target)) {
              menu.remove(); document.removeEventListener('click', close);
            }
          };
          setTimeout(() => document.addEventListener('click', close), 0);
        };

        slot.insertBefore(pill, slot.firstChild);
        slot.insertBefore(btn, pill);
        this.refreshStrengthPill();
      },
    };

    const inject = [];

    function apply(ctx) {
      if (typeof document === 'undefined') return;
      let disposed = false;
      try {
        Promptimizer.injectStylesheet();
        document.addEventListener('keydown', (ev) => {
          if ((ev.metaKey || ev.ctrlKey) && ev.shiftKey && ev.key.toLowerCase() === 'e') {
            ev.preventDefault();
            try { Promptimizer.run(); } catch (e) { console.warn(TAG, 'shortcut failed:', e); }
          }
          if (ev.key === 'Escape' && Promptimizer._working) Promptimizer.cancel();
        });
        // mount + re-mount on app re-renders (composer may re-create the slot)
        const schedule = () => {
          if (disposed) return;
          try { Promptimizer.mount(); } catch (e) { console.warn(TAG, 'mount failed:', e && e.message); }
        };
        schedule();
        const observer = new MutationObserver(() => requestAnimationFrame(schedule));
        observer.observe(document.documentElement, { childList: true, subtree: true });
        const dispose = () => {
          disposed = true;
          try { observer.disconnect(); } catch (e) { /* noop */ }
          try { document.getElementById('pmz-style')?.remove(); } catch (e) { /* noop */ }
        };
        if (ctx && typeof ctx.effect === 'function') ctx.effect(() => dispose, 'promptimizer: observer + styles');
      } catch (e) {
        console.warn(TAG, 'disabled (init failure):', e && e.message);
      }
    }

    exports.inject = inject;
    exports.apply = apply;
    return module.exports;
  }
});
