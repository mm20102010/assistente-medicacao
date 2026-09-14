/* MM Registro i18n 4.0 — pt-BR / en-US / es-ES with automatic device locale */
(function (global) {
  'use strict';

  const VERSION = '4.0.0';
  const SUPPORTED = Object.freeze(['pt-BR', 'en-US', 'es-ES']);
  const AUTO = 'auto';
  const catalogs = new Map();
  const nodeKeys = new WeakMap();
  const attrKeys = new WeakMap();
  let appName = 'common';
  let storageKey = 'mm.locale.mode';
  let mode = AUTO;
  let observer = null;

  const COMMON = {
    'pt-BR': {
      'nav.home':'Início','nav.history':'Histórico','nav.tools':'Ferramentas',
      'common.close':'Fechar','common.back':'Voltar','common.cancel':'Cancelar','common.confirm':'Confirmar','common.save':'Salvar','common.done':'Concluir','common.select':'Selecionar','common.clear':'Limpar','common.delete':'Excluir','common.add':'Adicionar','common.update':'Atualizar','common.image':'Imagem','common.yes':'Sim','common.no':'Não','common.all':'Tudo','common.from':'De','common.to':'Até','common.export':'Exportar','common.import':'Importar','common.loading':'Carregando…','common.ok':'OK',
      'section.record':'Registro','section.reports':'Relatórios','section.data':'Dados','section.install':'Instalar','section.language':'Idioma',
      'language.title':'Idioma','language.description':'Idioma da interface e das exportações','language.auto':'Automático','language.ptBR':'Português (Brasil)','language.enUS':'English (United States)','language.esES':'Español (España)','language.device':'Automático — idioma do dispositivo','language.autoDesc':'Usar o idioma do dispositivo quando disponível','language.ptDesc':'Português do Brasil','language.enDesc':'Inglês americano','language.esDesc':'Espanhol da Espanha',
      'language.changed':'Idioma atualizado','language.autoUnsupported':'Idioma do dispositivo não suportado; usando Português (Brasil).',
      'confirm.title':'Confirmar','confirm.cancel':'Cancelar','confirm.confirm':'Confirmar',
      'export.preview':'Prévia da imagem','export.image':'Exportar imagem','export.filtered.title':'Exportar histórico?','export.generating':'Gerando imagem…',
      'filter.clear':'Limpar filtros','filter.select':'Selecionar','filter.empty':'Nenhuma opção disponível.',
      'time.hour.one':'hora','time.hour.other':'horas','time.minute.one':'minuto','time.minute.other':'minutos','time.at':'às',
      'count.record.one':'registro','count.record.other':'registros','range.between':'{start} a {end}',
      'install.homeScreen':'Instalar na Tela de Início',
      'aria.mainNavigation':'Navegação principal','aria.back':'Voltar','aria.close':'Fechar','aria.tools':'Ferramentas'
    },
    'en-US': {
      'nav.home':'Home','nav.history':'History','nav.tools':'Tools',
      'common.close':'Close','common.back':'Back','common.cancel':'Cancel','common.confirm':'Confirm','common.save':'Save','common.done':'Done','common.select':'Select','common.clear':'Clear','common.delete':'Delete','common.add':'Add','common.update':'Update','common.image':'Image','common.yes':'Yes','common.no':'No','common.all':'All','common.from':'From','common.to':'To','common.export':'Export','common.import':'Import','common.loading':'Loading…','common.ok':'OK',
      'section.record':'Record','section.reports':'Reports','section.data':'Data','section.install':'Install','section.language':'Language',
      'language.title':'Language','language.description':'Language used in the interface and exports','language.auto':'Automatic','language.ptBR':'Português (Brasil)','language.enUS':'English (United States)','language.esES':'Español (España)','language.device':'Automatic — device language','language.autoDesc':'Use the device language when available','language.ptDesc':'Brazilian Portuguese','language.enDesc':'American English','language.esDesc':'Spanish from Spain',
      'language.changed':'Language updated','language.autoUnsupported':'Device language is not supported; using Portuguese (Brazil).',
      'confirm.title':'Confirm','confirm.cancel':'Cancel','confirm.confirm':'Confirm',
      'export.preview':'Image preview','export.image':'Export image','export.filtered.title':'Export history?','export.generating':'Generating image…',
      'filter.clear':'Clear filters','filter.select':'Select','filter.empty':'No options available.',
      'time.hour.one':'hour','time.hour.other':'hours','time.minute.one':'minute','time.minute.other':'minutes','time.at':'at',
      'count.record.one':'record','count.record.other':'records','range.between':'{start} to {end}',
      'install.homeScreen':'Add to Home Screen',
      'aria.mainNavigation':'Main navigation','aria.back':'Back','aria.close':'Close','aria.tools':'Tools'
    },
    'es-ES': {
      'nav.home':'Inicio','nav.history':'Historial','nav.tools':'Herramientas',
      'common.close':'Cerrar','common.back':'Volver','common.cancel':'Cancelar','common.confirm':'Confirmar','common.save':'Guardar','common.done':'Listo','common.select':'Seleccionar','common.clear':'Limpiar','common.delete':'Eliminar','common.add':'Añadir','common.update':'Actualizar','common.image':'Imagen','common.yes':'Sí','common.no':'No','common.all':'Todo','common.from':'Desde','common.to':'Hasta','common.export':'Exportar','common.import':'Importar','common.loading':'Cargando…','common.ok':'OK',
      'section.record':'Registro','section.reports':'Informes','section.data':'Datos','section.install':'Instalar','section.language':'Idioma',
      'language.title':'Idioma','language.description':'Idioma de la interfaz y de las exportaciones','language.auto':'Automático','language.ptBR':'Português (Brasil)','language.enUS':'English (United States)','language.esES':'Español (España)','language.device':'Automático — idioma del dispositivo','language.autoDesc':'Usar el idioma del dispositivo cuando esté disponible','language.ptDesc':'Portugués de Brasil','language.enDesc':'Inglés estadounidense','language.esDesc':'Español de España',
      'language.changed':'Idioma actualizado','language.autoUnsupported':'El idioma del dispositivo no es compatible; se usará Portugués (Brasil).',
      'confirm.title':'Confirmar','confirm.cancel':'Cancelar','confirm.confirm':'Confirmar',
      'export.preview':'Vista previa de la imagen','export.image':'Exportar imagen','export.filtered.title':'¿Exportar historial?','export.generating':'Generando imagen…',
      'filter.clear':'Limpiar filtros','filter.select':'Seleccionar','filter.empty':'No hay opciones disponibles.',
      'time.hour.one':'hora','time.hour.other':'horas','time.minute.one':'minuto','time.minute.other':'minutos','time.at':'a las',
      'count.record.one':'registro','count.record.other':'registros','range.between':'{start} a {end}',
      'install.homeScreen':'Añadir a la pantalla de inicio',
      'aria.mainNavigation':'Navegación principal','aria.back':'Volver','aria.close':'Cerrar','aria.tools':'Herramientas'
    }
  };
  catalogs.set('common', COMMON);

  function normalizeLocale(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return null;
    if (raw === 'pt-br' || raw === 'pt') return 'pt-BR';
    if (raw === 'en-us' || raw === 'en') return 'en-US';
    if (raw === 'es-es' || raw === 'es') return 'es-ES';
    if (raw.startsWith('pt-')) return 'pt-BR';
    if (raw.startsWith('en-')) return 'en-US';
    if (raw.startsWith('es-')) return 'es-ES';
    return null;
  }

  function deviceLocale() {
    const values = Array.isArray(global.navigator?.languages) && global.navigator.languages.length
      ? global.navigator.languages
      : [global.navigator?.language];
    for (const value of values) {
      const normalized = normalizeLocale(value);
      if (normalized) return normalized;
    }
    return 'pt-BR';
  }

  function resolveLocale(value = mode) {
    if (value === AUTO) return deviceLocale();
    return normalizeLocale(value) || 'pt-BR';
  }

  function readMode() {
    try {
      const value = global.localStorage?.getItem(storageKey);
      if (value === AUTO || SUPPORTED.includes(value)) return value;
    } catch (_) {}
    return AUTO;
  }

  function interpolate(text, vars = {}) {
    return String(text ?? '').replace(/\{([A-Za-z0-9_]+)\}/g, (_, key) => vars[key] ?? '');
  }

  function catalogValue(catalogName, locale, key) {
    const catalog = catalogs.get(catalogName);
    return catalog?.[locale]?.[key] ?? catalog?.['pt-BR']?.[key];
  }

  function t(key, vars = {}, locale = resolveLocale()) {
    const value = catalogValue(appName, locale, key) ?? catalogValue('common', locale, key) ?? catalogValue(appName, 'pt-BR', key) ?? catalogValue('common', 'pt-BR', key) ?? key;
    return interpolate(value, vars);
  }

  function allCatalogsForLocale(locale) {
    const result = [];
    const order = appName === 'common' ? ['common'] : ['common', appName];
    for (const name of order) {
      const cat = catalogs.get(name);
      if (cat) result.push(cat);
    }
    return result;
  }

  function keyForSource(source) {
    const normalized = String(source ?? '').trim();
    if (!normalized) return null;
    for (const cat of allCatalogsForLocale('pt-BR').reverse()) {
      const pt = cat['pt-BR'] || {};
      for (const [key, value] of Object.entries(pt)) if (String(value) === normalized) return key;
    }
    return null;
  }

  function keyForKnownTranslation(source) {
    const normalized = String(source ?? '').trim();
    if (!normalized) return null;
    const order = appName === 'common' ? ['common'] : [appName, 'common'];
    for (const name of order) {
      const cat = catalogs.get(name);
      if (!cat) continue;
      for (const locale of SUPPORTED) {
        for (const [key, value] of Object.entries(cat[locale] || {})) {
          if (String(value) === normalized) return key;
        }
      }
    }
    return null;
  }

  function valueMatchesKey(key, source) {
    const normalized = String(source ?? '').trim();
    if (!normalized || !key) return false;
    const order = appName === 'common' ? ['common'] : [appName, 'common'];
    for (const name of order) {
      const cat = catalogs.get(name);
      if (!cat) continue;
      for (const locale of SUPPORTED) if (String(cat[locale]?.[key] ?? '') === normalized) return true;
    }
    return false;
  }

  function translateSource(source, vars = {}, locale = resolveLocale()) {
    const key = keyForSource(source);
    return key ? t(key, vars, locale) : String(source ?? '');
  }

  function translateTextNode(node) {
    if (!node || node.nodeType !== 3) return;
    const raw = node.nodeValue || '';
    const trimmed = raw.trim();
    if (!trimmed) return;
    let key = nodeKeys.get(node);
    if (key && !valueMatchesKey(key, trimmed)) {
      key = keyForKnownTranslation(trimmed);
      if (key) nodeKeys.set(node, key);
      else { nodeKeys.delete(node); return; }
    }
    if (!key) {
      key = keyForKnownTranslation(trimmed) || keyForSource(trimmed);
      if (!key) return;
      nodeKeys.set(node, key);
    }
    const leading = raw.match(/^\s*/)?.[0] || '';
    const trailing = raw.match(/\s*$/)?.[0] || '';
    const nextValue = `${leading}${t(key)}${trailing}`;
    if (node.nodeValue !== nextValue) node.nodeValue = nextValue;
  }

  function translateAttributes(element) {
    if (!element?.getAttribute) return;
    let map = attrKeys.get(element);
    if (!map) { map = {}; attrKeys.set(element, map); }
    for (const attr of ['aria-label', 'title', 'placeholder']) {
      const current = element.getAttribute(attr);
      if (!current) continue;
      let key = map[attr];
      if (key && !valueMatchesKey(key, current)) {
        key = keyForKnownTranslation(current);
        if (key) map[attr] = key;
        else { delete map[attr]; continue; }
      }
      if (!key) {
        key = keyForKnownTranslation(current) || keyForSource(current);
        if (!key) continue;
        map[attr] = key;
      }
      const nextValue = t(key);
      if (element.getAttribute(attr) !== nextValue) element.setAttribute(attr, nextValue);
    }
  }

  function applyElement(element) {
    if (!element || element.nodeType !== 1) return;
    const key = element.getAttribute('data-i18n');
    if (key) {
      const nextText = t(key);
      if (element.textContent !== nextText) element.textContent = nextText;
    }
    for (const attr of ['aria-label','title','placeholder']) {
      const attrKey = element.getAttribute(`data-i18n-${attr}`);
      if (attrKey) element.setAttribute(attr, t(attrKey));
    }
    translateAttributes(element);
    for (const child of element.childNodes) {
      if (child.nodeType === 3) translateTextNode(child);
      else if (child.nodeType === 1 && !['SCRIPT','STYLE','SVG','TEXTAREA'].includes(child.nodeName)) applyElement(child);
    }
  }

  function apply(root = global.document) {
    const doc = root?.nodeType === 9 ? root : root?.ownerDocument || global.document;
    if (doc?.documentElement) doc.documentElement.lang = resolveLocale();
    const start = root?.nodeType === 9 ? root.documentElement : root;
    if (start) applyElement(start);
    updateLanguageSelector(doc || global.document);
  }

  function updateLanguageSelector(doc = global.document) {
    if (!doc) return;
    const current = doc.querySelector('[data-mm-language-current]');
    if (current) current.textContent = languageLabel(mode);
    for (const button of doc.querySelectorAll('[data-locale-mode]')) {
      const active = button.dataset.localeMode === mode;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
      const check = button.querySelector('[data-language-check]');
      if (check) check.textContent = active ? '✓' : '';
    }
  }

  function languageLabel(value = mode) {
    if (value === AUTO) return `${t('language.auto')} · ${t(`language.${resolveLocale() === 'pt-BR' ? 'ptBR' : resolveLocale() === 'en-US' ? 'enUS' : 'esES'}`)}`;
    if (value === 'pt-BR') return t('language.ptBR');
    if (value === 'en-US') return t('language.enUS');
    if (value === 'es-ES') return t('language.esES');
    return t('language.auto');
  }

  function emitLocaleChange(previousLocale, previousMode) {
    const detail = { mode, locale:resolveLocale(), previousLocale, previousMode };
    if (typeof global.CustomEvent === 'function') global.document?.dispatchEvent(new global.CustomEvent('mm:localechange', { detail }));
  }

  function setMode(nextMode, options = {}) {
    const normalizedMode = nextMode === AUTO ? AUTO : normalizeLocale(nextMode);
    if (normalizedMode !== AUTO && !SUPPORTED.includes(normalizedMode)) return false;
    const previousMode = mode;
    const previousLocale = resolveLocale(previousMode);
    mode = normalizedMode;
    try { global.localStorage?.setItem(storageKey, mode); } catch (_) {}
    apply(global.document);
    if (options.emit !== false) emitLocaleChange(previousLocale, previousMode);
    return true;
  }

  function registerCatalog(name, catalog) {
    if (!name || !catalog) throw new Error('MMI18n.registerCatalog requer nome e catálogo.');
    for (const locale of SUPPORTED) if (!catalog[locale]) throw new Error(`Catálogo ${name} sem locale ${locale}.`);
    const baseKeys = Object.keys(catalog['pt-BR']).sort();
    for (const locale of SUPPORTED.slice(1)) {
      const keys = Object.keys(catalog[locale]).sort();
      if (keys.length !== baseKeys.length || keys.some((key, i) => key !== baseKeys[i])) throw new Error(`Catálogo ${name}: chaves divergentes em ${locale}.`);
    }
    catalogs.set(name, catalog);
  }

  function init(options = {}) {
    appName = options.app || appName;
    storageKey = options.storageKey || storageKey;
    mode = readMode();
    apply(global.document);
    if (observer) observer.disconnect();
    if (global.MutationObserver && global.document?.body) {
      observer = new MutationObserver(mutations => {
        for (const mutation of mutations) {
          if (mutation.type === 'characterData') translateTextNode(mutation.target);
          for (const node of mutation.addedNodes || []) {
            if (node.nodeType === 3) translateTextNode(node);
            else if (node.nodeType === 1) applyElement(node);
          }
        }
      });
      observer.observe(global.document.body, { childList:true, characterData:true, subtree:true });
    }
    return api;
  }

  function bindLanguageSelector(options = {}) {
    const doc = options.document || global.document;
    const trigger = typeof options.trigger === 'string' ? doc.querySelector(options.trigger) : options.trigger;
    const dialog = typeof options.dialog === 'string' ? doc.querySelector(options.dialog) : options.dialog;
    if (trigger && dialog) trigger.addEventListener('click', () => {
      updateLanguageSelector(doc);
      if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open','');
    });
    for (const button of doc.querySelectorAll('[data-locale-mode]')) {
      button.addEventListener('click', () => {
        setMode(button.dataset.localeMode);
        if (typeof dialog?.close === 'function') dialog.close(); else dialog?.removeAttribute('open');
      });
    }
    updateLanguageSelector(doc);
  }

  function formatDate(value, options = {}) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat(resolveLocale(), options).format(date);
  }

  function formatNumber(value, options = {}) {
    return new Intl.NumberFormat(resolveLocale(), options).format(value);
  }

  function formatPercent(value, digits = 0) {
    return new Intl.NumberFormat(resolveLocale(), { style:'percent', minimumFractionDigits:digits, maximumFractionDigits:digits }).format(Number(value) / 100);
  }

  function formatDateTime(value, options = {}) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const locale = resolveLocale();
    const dateText = new Intl.DateTimeFormat(locale, { day:'2-digit', month:'2-digit', year:'numeric', ...(options.date || {}) }).format(date);
    const timeText = new Intl.DateTimeFormat(locale, { hour:locale === 'en-US' ? 'numeric' : '2-digit', minute:'2-digit', ...(locale === 'en-US' ? { hour12:true } : { hourCycle:'h23' }), ...(options.time || {}) }).format(date);
    const connector = locale === 'en-US' ? ' at ' : locale === 'es-ES' ? ' a las ' : ' às ';
    return `${dateText}${connector}${timeText}`;
  }

  function validateCatalog(name = appName) {
    const cat = catalogs.get(name);
    if (!cat) return { ok:false, error:`Catálogo ausente: ${name}` };
    const base = Object.keys(cat['pt-BR'] || {}).sort();
    const missing = {};
    for (const locale of SUPPORTED) missing[locale] = base.filter(key => !(key in (cat[locale] || {})));
    return { ok:Object.values(missing).every(list => !list.length), keys:base.length, missing };
  }

  const api = {
    VERSION, SUPPORTED, AUTO,
    registerCatalog, init, t, translateSource, apply, setMode,
    get mode(){ return mode; }, get locale(){ return resolveLocale(); },
    resolveLocale, normalizeLocale, deviceLocale, languageLabel,
    bindLanguageSelector, formatDate, formatDateTime, formatNumber, formatPercent,
    validateCatalog, hasSource(source){ return Boolean(keyForSource(source)); }
  };
  global.MMI18n = api;
})(typeof window !== 'undefined' ? window : globalThis);
