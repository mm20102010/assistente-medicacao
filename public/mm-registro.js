/* MM Registro Core 4.0 — canonical AppShell, chrome, navigation, identity, date ranges and safe-area secondary sheets */
(function (global) {
  'use strict';

  const VERSION = '4.0.0';
  const PRIMARY_VIEWS = Object.freeze(['home', 'history', 'tools']);

  function toElement(value, doc) {
    if (!value) return null;
    if (typeof value === 'string') return doc.querySelector(value);
    return value;
  }

  function unique(items) {
    return [...new Set(items.filter(Boolean))];
  }

  // Mantém pares De/Até sempre válidos e também restringe o seletor nativo.
  function constrainDateRange(fromTarget, toTarget, options = {}) {
    const doc = options.document || global.document;
    const from = toElement(fromTarget, doc);
    const to = toElement(toTarget, doc);
    if (!from || !to) throw new Error('MMRegistro.constrainDateRange requer os campos De e Até.');

    const changed = options.changed === 'to' ? 'to' : options.changed === 'from' ? 'from' : null;
    let adjusted = false;

    if (from.value && to.value && from.value > to.value) {
      if (changed === 'to') from.value = to.value;
      else to.value = from.value;
      adjusted = true;
    }

    if (to.value) from.setAttribute('max', to.value);
    else from.removeAttribute('max');
    if (from.value) to.setAttribute('min', from.value);
    else to.removeAttribute('min');

    return Object.freeze({ from: from.value || '', to: to.value || '', changed, adjusted });
  }

  function bindDateRange(fromTarget, toTarget, options = {}) {
    const doc = options.document || global.document;
    const from = toElement(fromTarget, doc);
    const to = toElement(toTarget, doc);
    if (!from || !to) throw new Error('MMRegistro.bindDateRange requer os campos De e Até.');

    const notify = changed => {
      const detail = constrainDateRange(from, to, { document: doc, changed });
      if (typeof options.onChange === 'function') options.onChange(detail);
      return detail;
    };
    const onFrom = () => notify('from');
    const onTo = () => notify('to');

    from.addEventListener('change', onFrom);
    to.addEventListener('change', onTo);
    constrainDateRange(from, to, { document: doc });

    return Object.freeze({
      from,
      to,
      refresh() { return constrainDateRange(from, to, { document: doc }); },
      destroy() {
        from.removeEventListener('change', onFrom);
        to.removeEventListener('change', onTo);
      }
    });
  }

  function hydrateAppIdentity(root, doc, options = {}) {
    const appName = String(
      options.appName ||
      root?.dataset?.mmAppName ||
      doc?.body?.dataset?.mmAppName ||
      ''
    ).trim();

    if (!appName) return '';
    if (root) root.dataset.mmAppName = appName;
    if (doc?.body) doc.body.dataset.mmAppName = appName;
    for (const label of doc.querySelectorAll('[data-mm-app-name-label]')) {
      label.textContent = appName;
      label.setAttribute('title', appName);
    }
    return appName;
  }

  function confirmAction(options = {}) {
    const doc = options.document || global.document;
    if (!doc) return Promise.resolve(false);
    const dialog = toElement(options.dialog || '#confirmDialog', doc);
    if (!dialog) throw new Error('MMRegistro.confirmAction requer um dialog de confirmação.');
    const title = dialog.querySelector('[data-mm-confirm-title],#confirmTitle');
    const text = dialog.querySelector('[data-mm-confirm-text],#confirmText');
    const button = dialog.querySelector('[data-mm-confirm-button],[value="confirm"]');
    if (title) title.textContent = String(options.title || 'Confirmar');
    if (text) text.textContent = String(options.text || '');
    if (button) {
      button.textContent = String(options.confirmLabel || 'Confirmar');
      button.classList.toggle('danger-btn', !!options.destructive);
      button.classList.toggle('primary-btn', !options.destructive);
    }
    return new Promise(resolve => {
      const handler = () => { dialog.removeEventListener('close', handler); resolve(dialog.returnValue === 'confirm'); };
      dialog.addEventListener('close', handler);
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    });
  }

  function validateCanonicalChrome(root, doc) {
    const errors = [];
    if (!root.classList.contains('mm-app-shell')) errors.push('AppShell deve usar .mm-app-shell.');

    const tabbars = [...doc.querySelectorAll('.mm-tabbar')];
    if (tabbars.length !== 1) errors.push(`MM Registro requer exatamente uma .mm-tabbar principal; encontrado: ${tabbars.length}.`);

    for (const view of PRIMARY_VIEWS) {
      const panel = root.querySelector(`[data-mm-view-panel="${view}"]`);
      if (!panel) {
        errors.push(`View canônica ausente: ${view}.`);
        continue;
      }
      if (view === 'home' && !panel.querySelector('.mm-primary-header')) errors.push('A view home requer .mm-primary-header.');
      if (view !== 'home' && !panel.querySelector('.mm-secondary-header')) errors.push(`A view ${view} requer .mm-secondary-header.`);
    }

    if (tabbars[0]) {
      for (const view of PRIMARY_VIEWS) {
        if (!tabbars[0].querySelector(`[data-mm-view="${view}"]`)) errors.push(`Tab principal ausente: ${view}.`);
      }
    }

    if (errors.length) throw new Error(`MM Registro chrome inválido:\n- ${errors.join('\n- ')}`);
    return true;
  }


  const secondaryFocus = new WeakMap();

  function resolveSecondaryLayer(target, doc) {
    const element = toElement(target, doc);
    if (!element) throw new Error('MMRegistro secondary sheet não encontrado.');
    if (!element.matches('[data-mm-secondary-layer]')) {
      throw new Error('MMRegistro secondary sheet requer [data-mm-secondary-layer].');
    }
    if (!element.querySelector('.mm-secondary-sheet')) {
      throw new Error('MMRegistro secondary sheet requer um filho .mm-secondary-sheet.');
    }
    return element;
  }

  function syncSecondaryBodyState(doc) {
    if (!doc?.body) return;
    const hasOpenLayer = !!doc.querySelector('[data-mm-secondary-layer].open,[data-mm-secondary-layer][aria-hidden="false"]');
    doc.body.classList.toggle('mm-secondary-open', hasOpenLayer);
    doc.body.classList.toggle('tabbar-suspended', hasOpenLayer);
  }

  function openSecondarySheet(target, options = {}) {
    const doc = options.document || global.document;
    if (!doc) throw new Error('MMRegistro.openSecondarySheet requer um document.');
    const layer = resolveSecondaryLayer(target, doc);

    for (const other of doc.querySelectorAll('[data-mm-secondary-layer].open,[data-mm-secondary-layer][aria-hidden="false"]')) {
      if (other !== layer) closeSecondarySheet(other, { document: doc, restoreFocus: false });
    }

    secondaryFocus.set(layer, doc.activeElement);
    const sheet = layer.querySelector('.mm-secondary-sheet');
    layer.inert = false;
    layer.removeAttribute('inert');
    layer.classList.add('open');
    layer.setAttribute('aria-hidden', 'false');
    try { sheet.scrollTop = 0; } catch (_) {}
    syncSecondaryBodyState(doc);

    const resetScroll = () => { try { sheet.scrollTop = 0; } catch (_) {} };
    if (typeof global.requestAnimationFrame === 'function') global.requestAnimationFrame(resetScroll);
    if (options.focus !== false) {
      const close = layer.querySelector('[data-mm-secondary-close],.sheet-close');
      if (close && typeof close.focus === 'function') {
        if (typeof global.requestAnimationFrame === 'function') global.requestAnimationFrame(() => close.focus({ preventScroll:true }));
        else close.focus();
      }
    }
    return layer;
  }

  function closeSecondarySheet(target, options = {}) {
    const doc = options.document || global.document;
    if (!doc) return null;
    const layer = toElement(target, doc);
    if (!layer) return null;
    layer.classList.remove('open');
    layer.setAttribute('aria-hidden', 'true');
    layer.inert = true;
    layer.setAttribute('inert', '');
    syncSecondaryBodyState(doc);

    if (options.restoreFocus !== false) {
      const previous = secondaryFocus.get(layer);
      if (previous && previous.isConnected && typeof previous.focus === 'function') {
        try { previous.focus({ preventScroll:true }); } catch (_) { try { previous.focus(); } catch (_) {} }
      }
    }
    secondaryFocus.delete(layer);
    return layer;
  }

  function bindSecondarySheets(options = {}) {
    const doc = options.document || global.document;
    if (!doc) return () => {};
    for (const layer of doc.querySelectorAll('[data-mm-secondary-layer][aria-hidden="true"]')) {
      layer.inert = true;
      layer.setAttribute('inert', '');
    }
    const cleanups = [];
    for (const button of doc.querySelectorAll('[data-mm-secondary-close]')) {
      const handler = event => {
        const layer = button.closest('[data-mm-secondary-layer]');
        if (!layer) return;
        event.preventDefault();
        closeSecondarySheet(layer, { document: doc });
      };
      button.addEventListener('click', handler);
      cleanups.push(() => button.removeEventListener('click', handler));
    }
    return () => { while (cleanups.length) cleanups.pop()(); };
  }

  function createAppShell(options = {}) {
    const doc = options.document || global.document;
    if (!doc) throw new Error('MMRegistro.createAppShell requer um document.');

    const root = toElement(options.root, doc) || doc.querySelector('[data-mm-app-shell]');
    if (!root) throw new Error('MMRegistro AppShell não encontrado.');
    const appName = hydrateAppIdentity(root, doc, options);
    if (options.validateChrome !== false) validateCanonicalChrome(root, doc);

    const panelScope = toElement(options.panelScope, doc) || root;
    const navScope = toElement(options.navScope, doc) || doc.querySelector('.mm-tabbar') || doc;
    const panels = [...panelScope.querySelectorAll('[data-mm-view-panel]')];
    if (!panels.length) throw new Error('MMRegistro AppShell requer ao menos um [data-mm-view-panel].');

    const panelByView = new Map();
    for (const panel of panels) {
      const view = String(panel.dataset.mmViewPanel || '').trim();
      if (!view) continue;
      if (panelByView.has(view)) throw new Error(`MMRegistro view duplicada: ${view}`);
      panelByView.set(view, panel);
    }

    const navButtons = [...navScope.querySelectorAll('[data-mm-view]')];
    const goButtons = [...doc.querySelectorAll('[data-mm-go-view]')];
    const views = [...panelByView.keys()];
    const fallback = views[0];
    const defaultView = panelByView.has(options.defaultView) ? options.defaultView : fallback;
    const legacyViewMap = options.legacyViewMap || {};
    const activeClasses = unique(['is-active', options.activeClass, options.compatibilityActiveClass]);
    let activeView = null;
    let destroyed = false;
    const cleanups = [];

    function normalizeView(view) {
      const candidate = String(view || '').trim();
      return panelByView.has(candidate) ? candidate : defaultView;
    }

    function emit(name, detail) {
      if (typeof global.CustomEvent !== 'function') return;
      root.dispatchEvent(new global.CustomEvent(name, { bubbles: true, detail }));
    }

    let homeResizeObserver = null;
    let homeMeasureFrame = 0;

    function measureHomeScrollNeed() {
      if (!doc.body) return;
      const isHome = activeView === 'home';
      doc.body.classList.toggle('mm-home-active', isHome);
      if (!isHome) { doc.body.classList.remove('mm-home-needs-scroll'); return; }
      doc.body.classList.remove('mm-home-needs-scroll');
      const panel = panelByView.get('home');
      const tabbar = doc.querySelector('.mm-tabbar');
      if (!panel || !tabbar || typeof panel.getBoundingClientRect !== 'function') return;
      const needsScroll = panel.getBoundingClientRect().bottom > (tabbar.getBoundingClientRect().top - 12);
      doc.body.classList.toggle('mm-home-needs-scroll', needsScroll);
    }

    function scheduleHomeScrollMeasure() {
      if (typeof global.requestAnimationFrame !== 'function') return measureHomeScrollNeed();
      if (homeMeasureFrame) global.cancelAnimationFrame?.(homeMeasureFrame);
      homeMeasureFrame = global.requestAnimationFrame(() => { homeMeasureFrame = 0; measureHomeScrollNeed(); });
    }

    function setState(view) {
      for (const [name, panel] of panelByView) {
        const active = name === view;
        panel.hidden = !active;
        panel.setAttribute('aria-hidden', active ? 'false' : 'true');
        for (const className of activeClasses) panel.classList.toggle(className, active);
      }

      for (const button of navButtons) {
        const active = button.dataset.mmView === view;
        for (const className of activeClasses) button.classList.toggle(className, active);
        button.setAttribute('aria-selected', active ? 'true' : 'false');
        if (!button.hasAttribute('role')) button.setAttribute('role', 'tab');
      }

      root.dataset.mmActiveView = view;
      root.dataset.activeView = view;
      if (options.legacyAttribute !== false) root.dataset.activeTab = legacyViewMap[view] || view;
      if (doc.body) {
        doc.body.dataset.mmCoreVersion = VERSION;
        doc.body.dataset.mmActiveView = view;
        doc.body.dataset.activeView = view;
        if (options.legacyAttribute !== false) doc.body.dataset.activeTab = legacyViewMap[view] || view;
      }
      scheduleHomeScrollMeasure();
    }

    function setView(requestedView, meta = {}) {
      if (destroyed) return activeView;
      const nextView = normalizeView(requestedView);
      if (nextView === activeView && !meta.force) return activeView;
      const previousView = activeView;
      const context = { root, previousView, nextView, source: meta.source || 'api' };

      if (typeof options.beforeViewChange === 'function') {
        const result = options.beforeViewChange(context);
        if (result === false) return activeView;
      }
      emit('mm:before-view-change', context);

      activeView = nextView;
      setState(nextView);

      const shouldScroll = meta.scroll !== false && options.scrollToTop !== false;
      if (shouldScroll && typeof global.scrollTo === 'function') {
        try { global.scrollTo({ top: 0, left: 0, behavior: 'instant' }); }
        catch { global.scrollTo(0, 0); }
      }

      if (typeof options.afterViewChange === 'function') options.afterViewChange(context);
      emit('mm:view-change', context);
      return activeView;
    }

    function bindClick(element, resolver, source) {
      const handler = event => {
        const view = resolver(element);
        if (!view) return;
        event.preventDefault();
        setView(view, { source });
      };
      element.addEventListener('click', handler);
      cleanups.push(() => element.removeEventListener('click', handler));
    }

    for (const button of navButtons) bindClick(button, el => el.dataset.mmView, 'tabbar');
    for (const button of goButtons) bindClick(button, el => el.dataset.mmGoView, 'control');

    const onViewportChange = () => scheduleHomeScrollMeasure();
    global.addEventListener?.('resize', onViewportChange, { passive:true });
    global.addEventListener?.('orientationchange', onViewportChange, { passive:true });
    cleanups.push(() => global.removeEventListener?.('resize', onViewportChange));
    cleanups.push(() => global.removeEventListener?.('orientationchange', onViewportChange));
    if (typeof global.ResizeObserver === 'function') {
      const homePanel = panelByView.get('home');
      if (homePanel) { homeResizeObserver = new global.ResizeObserver(() => scheduleHomeScrollMeasure()); homeResizeObserver.observe(homePanel); cleanups.push(() => homeResizeObserver?.disconnect()); }
    }

    const initialView = normalizeView(options.initialView || root.dataset.mmActiveView || root.dataset.activeView || defaultView);
    setView(initialView, { force: true, source: 'init', scroll: false });

    return {
      version: VERSION,
      appName,
      root,
      views: Object.freeze([...views]),
      get activeView() { return activeView; },
      setView,
      refresh() { setState(activeView || defaultView); return activeView; },
      validateChrome() { return validateCanonicalChrome(root, doc); },
      destroy() {
        if (destroyed) return;
        destroyed = true;
        if (homeMeasureFrame) global.cancelAnimationFrame?.(homeMeasureFrame);
        while (cleanups.length) cleanups.pop()();
      }
    };
  }

  global.MMRegistro = Object.assign(global.MMRegistro || {}, {
    version: VERSION,
    primaryViews: PRIMARY_VIEWS,
    validateCanonicalChrome,
    hydrateAppIdentity,
    createAppShell,
    confirmAction,
    constrainDateRange,
    bindDateRange,
    openSecondarySheet,
    closeSecondarySheet,
    bindSecondarySheets
  });
})(typeof window !== 'undefined' ? window : globalThis);
