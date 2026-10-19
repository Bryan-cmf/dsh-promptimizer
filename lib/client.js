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
    const LS = { url: 'promptimizer-url', key: 'promptimizer-key', model: 'promptimizer-model', strength: 'promptimizer-strength', lang: 'promptimizer-lang' };

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
        settingsTitle: '端點與金鑰設定', urlLabel: 'OpenAI 相容端點',
        keyLabel: 'API key（存於本機 localStorage）', modelLabel: '模型（可選）',
        modelHint: '留空 = 使用本 session 當前選中的模型',
        save: '儲存', cancel: '取消', saved: '已儲存設定',
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
        settingsTitle: 'Endpoint & Key Settings', urlLabel: 'OpenAI-compatible endpoint',
        keyLabel: 'API key (stored in local localStorage)', modelLabel: 'Model (optional)',
        modelHint: 'Empty = use the session\u2019s currently selected model',
        save: 'Save', cancel: 'Cancel', saved: 'Settings saved',
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

      /** Optimize via the host bridge (same-origin route): zero config, and it
       * follows the app's own providers + the session's currently selected
       * model. A custom external endpoint is only used when the user set BOTH
       * url and key in settings (opt-in path for CORS-enabled providers). */
      async callModel(level, text, model) {
        this._abort = new AbortController();
        try {
          const res = await fetch('/api/promptimizer/optimize', {
            method: 'POST',
            signal: this._abort.signal,
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ text, strength: level, model: (lsGet(LS.model, '') || '').trim() || model }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok || data.error) throw new Error(data.error || ('bridge ' + res.status));
          const out = String(data.text || '').trim();
          if (!out) throw new Error('empty completion');
          return out;
        } catch (e) {
          if (e && e.name === 'AbortError') throw e;
          const url = lsGet(LS.url, '').trim();
          const key = this.apiKey();
          if (!url || !key) throw e;
          return await this.callCustomEndpoint(level, text, url, key);
        }
      },
      /** Direct OpenAI-compatible call — needs a CORS-enabled provider. */
      async callCustomEndpoint(level, text, url, key) {
        const res = await fetch(String(url).replace(/\/$/, '') + '/chat/completions', {
          method: 'POST',
          signal: this._abort.signal,
          headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
          body: JSON.stringify({
            model: modelIdFor(lsGet(LS.model, '') || ''),
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
        // Optional model override; empty = follow the session's current model.
        const model = (lsGet(LS.model, '') || '').trim() || currentModel();
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

      /** Copy the composer toolbar's compact-control metrics onto our
       * controls (the model selector's text is visibly larger; the toolbar's
       * own buttons are the reference the user asked to match). */
      adoptCompactStyle(el) {
        try {
          const ref = document.querySelector(
            '[data-slot="conversation.input.left"] button, ' +
            '[data-slot="conversation.input.right"] button, ' +
            '[data-slot="conversation.input.model"] button[aria-label]');
          if (ref) {
            const cs = getComputedStyle(ref);
            for (const prop of ['font-size', 'height', 'border-radius', 'color']) {
              el.style.setProperty(prop, cs.getPropertyValue(prop));
            }
          } else {
            el.style.fontSize = '12px';
            el.style.borderRadius = '8px';
          }
          el.style.fontWeight = '500';
          el.style.padding = '0 8px';
          el.style.letterSpacing = 'normal';
          el.style.display = 'flex';
          el.style.alignItems = 'center';
          el.style.background = 'transparent';
          el.style.border = 'none';
        } catch (e) { /* keep default look */ }
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

      buildStrengthMenu(anchor) {
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
        // close() is the single teardown path: menu + anchor caret state.
        const onDoc = (ev) => {
          if (!menu.contains(ev.target) && !(anchor && anchor.contains(ev.target))) close();
        };
        const close = () => {
          menu.remove();
          if (anchor) anchor.classList.remove('pmz-open');
          document.removeEventListener('click', onDoc);
        };
        menu.querySelectorAll('[data-level]').forEach((it) => {
          const n = parseInt(it.getAttribute('data-level'), 10);
          it.querySelector('span').textContent = this.strengthName(n);
          it.querySelector('small').textContent = T(['lightDesc', 'stdDesc', 'deepDesc'][n - 1]);
          if (n === this.strength) it.classList.add('cur');
          it.onclick = () => {
            this.strength = n;
            lsSet(LS.strength, String(n));
            this.refreshStrengthPill();
            close();
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
          close();
        };
        menu.querySelector('[data-act="cfg"] span:last-child').textContent = T('keyMenu');
        menu.querySelector('[data-act="cfg"]').onclick = () => { close(); Promptimizer.openSettings(); };
        menu.addEventListener('click', (e) => e.stopPropagation());
        setTimeout(() => document.addEventListener('click', onDoc), 0);
        return menu;
      },
      /**
       * In-DOM settings panel. window.prompt() is NOT implemented by the
       * desktop shell (silent no-op — that was the "settings do nothing"
       * bug), so configuration is a proper modal form instead.
       * Model field is optional: empty = follow the session's current model.
       */
      openSettings() {
        try {
          const old = document.getElementById('pmz-settings-wrap');
          if (old) { old.remove(); return; }
          const wrap = document.createElement('div');
          wrap.id = 'pmz-settings-wrap';
          const card = document.createElement('div');
          card.id = 'pmz-settings';
          card.innerHTML =
            '<div class="pmz-sm-title"></div>' +
            '<label><span class="lb"></span><input id="pmz-cfg-url" type="text" spellcheck="false"/></label>' +
            '<label><span class="lb"></span><input id="pmz-cfg-key" type="password" spellcheck="false"/></label>' +
            '<label><span class="lb"></span><input id="pmz-cfg-model" type="text" spellcheck="false"/></label>' +
            '<div class="pmz-model-hint"></div>' +
            '<div class="pmz-cfg-actions"><button id="pmz-cfg-cancel"></button><button id="pmz-cfg-save"></button></div>';
          card.querySelector('.pmz-sm-title').textContent = T('settingsTitle');
          const labs = card.querySelectorAll('label .lb');
          labs[0].textContent = T('urlLabel');
          labs[1].textContent = T('keyLabel');
          labs[2].textContent = T('modelLabel');
          const urlIn = card.querySelector('#pmz-cfg-url');
          urlIn.value = lsGet(LS.url, '') || DEFAULT_URL;
          const keyIn = card.querySelector('#pmz-cfg-key');
          keyIn.value = lsGet(LS.key, '');
          const modelIn = card.querySelector('#pmz-cfg-model');
          modelIn.value = lsGet(LS.model, '');
          modelIn.placeholder = T('modelHint');
          card.querySelector('.pmz-model-hint').textContent = T('modelHint');
          card.querySelector('#pmz-cfg-save').textContent = T('save');
          card.querySelector('#pmz-cfg-cancel').textContent = T('cancel');
          const onKey = (ev) => { if (ev.key === 'Escape') dismiss(); };
          const dismiss = () => { wrap.remove(); document.removeEventListener('keydown', onKey); };
          card.querySelector('#pmz-cfg-save').onclick = () => {
            lsSet(LS.url, urlIn.value.trim());
            lsSet(LS.key, keyIn.value.trim());
            lsSet(LS.model, modelIn.value.trim());
            dismiss();
            this.setStatus(T('saved'));
          };
          card.querySelector('#pmz-cfg-cancel').onclick = dismiss;
          wrap.onclick = (e) => { if (e.target === wrap) dismiss(); };
          card.addEventListener('click', (e) => e.stopPropagation());
          wrap.appendChild(card);
          document.body.appendChild(wrap);
          document.addEventListener('keydown', onKey);
          setTimeout(() => urlIn.focus(), 30);
        } catch (e) { console.warn(TAG, 'settings failed:', e && e.message); }
      },
      refreshStrengthPill() {
        const pill = document.getElementById('pmz-strength');
        if (!pill) return;
        // Icon-only caret button (permission/model selector style): the level
        // lives in the tooltip and the open menu's highlighted row.
        pill.title = T('strengthTip') + '：' + this.strengthName(this.strength);
      },

      injectStylesheet() {
        if (document.getElementById('pmz-style')) return;
        const style = document.createElement('style');
        style.id = 'pmz-style';
        style.textContent = `
          :root { --pmz-accent: ${ACCENT}; }
          .pmz-ctl { cursor: pointer; user-select: none; }
          #pmz-opt b { font-weight: 500; }
          /* Phones: the composer row cannot fit the word, keep the sparkle. */
          @media (max-width: 520px) {
            #pmz-opt b { display: none; }
            #pmz-opt { padding-right: .35em; }
          }
          /* Very narrow composer rows: the strength caret is what tips the row
             over into a second line at 360px (measured: trailing 162px vs the
             135px that fits). Keep the sparkle, drop the caret; long-press on
             the sparkle still opens the settings. */
          @media (max-width: 420px) {
            #pmz-strength { display: none; }
          }
          .pmz-ctl:hover { background: color-mix(in srgb, CanvasText 7%, transparent) !important; }
          .pmz-ctl.active { color: var(--pmz-accent) !important; }
          .pmz-ctl.working { animation: pmz-pulse 1.6s ease-in-out infinite; color: var(--pmz-accent) !important; }
          @keyframes pmz-pulse { 0%, 100% { opacity: 1; } 50% { opacity: .35; } }
          #pmz-strength .pmz-caret { display: block; width: .68em; height: auto; opacity: .6; transition: transform .15s ease, opacity .15s ease; }
          #pmz-strength.pmz-open .pmz-caret { transform: rotate(180deg); opacity: .95; }
          #pmz-settings-wrap { position: fixed; inset: 0; z-index: 1300; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,.28); }
          #pmz-settings { width: 320px; padding: 12px 14px;
            background: color-mix(in srgb, var(--pmz-accent) 4%, Canvas); color: CanvasText;
            border: 1px solid color-mix(in srgb, var(--pmz-accent) 30%, transparent);
            border-radius: 12px; box-shadow: 0 14px 34px rgba(0,0,0,.28); font-size: 12.5px; }
          #pmz-settings label { display: flex; flex-direction: column; gap: 4px; margin-bottom: 9px; }
          #pmz-settings .lb { font-weight: 600; opacity: .75; }
          #pmz-settings input { background: color-mix(in srgb, CanvasText 6%, transparent); color: CanvasText;
            border: 1px solid color-mix(in srgb, CanvasText 18%, transparent); border-radius: 7px;
            padding: 6px 9px; font-size: 12.5px; outline: none; width: 100%; box-sizing: border-box; }
          #pmz-settings input:focus { border-color: var(--pmz-accent); }
          #pmz-settings .pmz-model-hint { opacity: .55; font-size: 11px; margin: -3px 0 10px; }
          #pmz-settings .pmz-cfg-actions { display: flex; gap: 8px; justify-content: flex-end; }
          #pmz-settings .pmz-cfg-actions button { cursor: pointer; border-radius: 7px;
            border: 1px solid color-mix(in srgb, CanvasText 20%, transparent);
            background: transparent; color: CanvasText; padding: 5px 12px; font-size: 12px; }
          #pmz-settings #pmz-cfg-save { background: var(--pmz-accent); border-color: transparent; color: #fff; }
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
        this.adoptCompactStyle(btn);
        btn.style.paddingRight = '3px';
        btn.onclick = async (e) => { e.stopPropagation(); try { await this.run(); } catch (err) { console.warn(TAG, 'failed:', err); } };
        btn.oncontextmenu = (e) => { e.preventDefault(); e.stopPropagation(); this.openSettings(); };

        const pill = document.createElement('button');
        pill.id = 'pmz-strength'; pill.type = 'button'; pill.className = 'pmz-ctl';
        pill.innerHTML = '<svg class="pmz-caret" viewBox="0 0 12 8" aria-hidden="true"><path d="M1.5 1.75 6 6l4.5-4.25" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        this.adoptCompactStyle(pill);
        // Hug the 優化 label: override the copied selector paddings so the
        // caret sits tight against the text, like one composite control.
        pill.style.paddingLeft = '2px';
        pill.style.paddingRight = '4px';
        btn.style.paddingRight = '3px';
        pill.onclick = (e) => {
          e.stopPropagation();
          const existing = document.getElementById('pmz-strength-menu');
          if (existing) { existing.remove(); pill.classList.remove('pmz-open'); return; }
          const menu = this.buildStrengthMenu(pill);
          const undo = menu.querySelector('[data-act="undo"]');
          if (undo) undo.style.display = (this.lastOriginal !== null) ? '' : 'none';
          document.body.appendChild(menu);
          const rect = pill.getBoundingClientRect();
          menu.style.left = Math.max(8, Math.min(window.innerWidth - 248, rect.left)) + 'px';
          // Open UPWARD: the composer toolbar sits at the app bottom edge, so a
          // downward menu overflows the window and becomes unreachable
          // (verified on the desktop shell). Measure first, then clamp.
          const mh = menu.offsetHeight || 190;
          menu.style.top = Math.max(8, rect.top - mh - 6) + 'px';
          pill.classList.add('pmz-open'); // caret flips to inverted-v, selector-style
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
