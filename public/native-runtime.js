(() => {
  const capacitor = window.Capacitor;
  const nativeProtocol = /^(capacitor|ionic):$/i.test(window.location?.protocol || '');
  const isNative = Boolean(capacitor?.isNativePlatform?.()) || nativeProtocol;
  const platform = isNative ? (capacitor?.getPlatform?.() || (nativeProtocol ? 'ios' : 'native')) : 'web';

  // Native-only bridge. The PWA never creates or calls this plugin.
  const watchPlugin = isNative && platform === 'ios'
    ? (capacitor?.registerPlugin?.('AssistenteWatch') || capacitor?.Plugins?.AssistenteWatch || null)
    : null;

  async function syncMedicines(medicines, options = {}) {
    if (!watchPlugin?.syncMedicines) {
      return { accepted: false, delivered: false, reason: 'unavailable' };
    }

    const values = Array.isArray(medicines)
      ? medicines
          .map(value => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 80))
          .filter(Boolean)
          .slice(0, 200)
      : [];

    if (!values.length) {
      return { accepted: false, delivered: false, reason: 'empty' };
    }

    const locale = String(options?.locale ?? '').trim().slice(0, 20);
    const rawTexts = options?.texts && typeof options.texts === 'object' ? options.texts : {};
    const texts = Object.fromEntries(
      Object.entries(rawTexts)
        .map(([key, value]) => [String(key).slice(0, 40), String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 120)])
        .filter(([key, value]) => key && value)
        .slice(0, 30)
    );
    const payload = { medicines: values };
    if (options?.projection && typeof options.projection === 'object') payload.projection = options.projection;
    if (locale) payload.locale = locale;
    if (Object.keys(texts).length) payload.texts = texts;

    try {
      return await watchPlugin.syncMedicines(payload);
    } catch (error) {
      console.warn('Não foi possível sincronizar os remédios com o Apple Watch:', error);
      return { accepted: false, delivered: false, reason: 'error' };
    }
  }

  async function getWatchMedicationEvents() {
    if (!watchPlugin?.getPendingMedicationEvents) return [];

    try {
      const result = await watchPlugin.getPendingMedicationEvents();
      const events = Array.isArray(result?.events) ? result.events : [];
      return events
        .map(event => {
          const normalized = {
            id: String(event?.id ?? '').trim().slice(0, 100),
            medicine: String(event?.medicine ?? '').replace(/\s+/g, ' ').trim().slice(0, 80),
            occurredAt: String(event?.occurredAt ?? '').trim().slice(0, 64),
            localDate: String(event?.localDate ?? '').trim().slice(0, 10),
            localTime: String(event?.localTime ?? '').trim().slice(0, 5),
          };
          const scheduleId = String(event?.scheduleId ?? '').trim().slice(0, 100);
          const scheduledAt = String(event?.scheduledAt ?? '').trim().slice(0, 64);
          if (scheduleId) normalized.scheduleId = scheduleId;
          if (scheduledAt) normalized.scheduledAt = scheduledAt;
          return normalized;
        })
        .filter(event => event.id && event.medicine && event.occurredAt);
    } catch (error) {
      console.warn('Não foi possível ler os registros pendentes do Apple Watch:', error);
      return [];
    }
  }

  async function acknowledgeWatchMedicationEvent(eventId) {
    if (!watchPlugin?.acknowledgeMedicationEvent) {
      return { acknowledged: false, reason: 'unavailable' };
    }

    const id = String(eventId ?? '').trim().slice(0, 100);
    if (!id) return { acknowledged: false, reason: 'empty' };

    try {
      return await watchPlugin.acknowledgeMedicationEvent({ id });
    } catch (error) {
      console.warn('Não foi possível confirmar o registro recebido do Apple Watch:', error);
      return { acknowledged: false, reason: 'error' };
    }
  }


  async function discardWatchMedicationEvent(eventId) {
    if (!watchPlugin?.discardMedicationEvent) {
      return { discarded: false, reason: 'unavailable' };
    }

    const id = String(eventId ?? '').trim().slice(0, 100);
    if (!id) return { discarded: false, reason: 'empty' };

    try {
      return await watchPlugin.discardMedicationEvent({ id });
    } catch (error) {
      console.warn('Não foi possível consumir o registro pendente do Apple Watch antes da exclusão:', error);
      return { discarded: false, reason: 'error' };
    }
  }



  async function resetWatchSynchronizationState(resetAt) {
    if (!watchPlugin?.resetSynchronizationState) {
      return { reset: false, reason: 'unavailable' };
    }

    const value = String(resetAt ?? '').trim().slice(0, 64);
    if (!value || Number.isNaN(new Date(value).getTime())) {
      return { reset: false, reason: 'invalid' };
    }

    try {
      return await watchPlugin.resetSynchronizationState({ resetAt: value });
    } catch (error) {
      console.warn('Não foi possível redefinir o estado de sincronização do Apple Watch:', error);
      return { reset: false, reason: 'error' };
    }
  }


  async function reconcileMedicationNotifications(notifications, enabled = true) {
    if (!watchPlugin?.reconcileMedicationNotifications) return { accepted:false, reason:'unavailable' };
    const list = Array.isArray(notifications) ? notifications.slice(0,60).map(item=>({
      id:String(item?.id||'').slice(0,160),
      title:String(item?.title||'').slice(0,100),
      body:String(item?.body||'').slice(0,180),
      at:String(item?.at||'').slice(0,64),
      medicine:String(item?.medicine||item?.title||'').slice(0,80),
      scheduleId:String(item?.scheduleId||'').slice(0,100),
      scheduledAt:String(item?.scheduledAt||item?.at||'').slice(0,64)
    })).filter(x=>x.id&&x.title&&x.at) : [];
    try { return await watchPlugin.reconcileMedicationNotifications({ notifications:list, enabled:Boolean(enabled) }); }
    catch(error){ console.warn('Não foi possível reconciliar os lembretes:',error); return {accepted:false,reason:'error'}; }
  }

  async function consumeScheduledMedicationNotificationContext() {
    if (!watchPlugin?.consumeScheduledMedicationNotificationContext) return null;
    try {
      const result = await watchPlugin.consumeScheduledMedicationNotificationContext();
      if (!result?.available) return null;
      const context = {
        medicine:String(result?.medicine||'').replace(/\s+/g,' ').trim().slice(0,80),
        scheduleId:String(result?.scheduleId||'').trim().slice(0,100),
        scheduledAt:String(result?.scheduledAt||'').trim().slice(0,64)
      };
      return context.medicine && context.scheduleId && context.scheduledAt ? context : null;
    } catch(error) {
      console.warn('Não foi possível recuperar o contexto do lembrete aberto:',error);
      return null;
    }
  }

  // Keep the WebView event-driven: when Swift receives a Watch medication event,
  // forward the native plugin notification as a normal DOM event. The durable
  // native queue remains the source of recovery if this notification is missed.
  const watchEventsReady = watchPlugin?.addListener ? Promise.resolve(
      watchPlugin.addListener('watchMedicationEventAvailable', () => {
        window.dispatchEvent(new CustomEvent('mm:watch-medication-event-available'));
      })
    ).catch(error => {
      console.warn('Não foi possível ativar o listener de registros do Apple Watch:', error);
      throw error;
    })
  : Promise.resolve(null);


  const notificationEventsReady = watchPlugin?.addListener ? Promise.resolve(
      watchPlugin.addListener('scheduledMedicationNotificationOpened', () => {
        window.dispatchEvent(new CustomEvent('mm:scheduled-medication-notification-opened'));
      })
    ).catch(error => {
      console.warn('Não foi possível ativar o listener de abertura de lembretes:', error);
      throw error;
    })
  : Promise.resolve(null);

  window.MMNative = Object.freeze({
    isNative,
    platform,
    isIOS: platform === 'ios',
    isWeb: !isNative,
    syncMedicines,
    getWatchMedicationEvents,
    acknowledgeWatchMedicationEvent,
    discardWatchMedicationEvent,
    resetWatchSynchronizationState,
    reconcileMedicationNotifications,
    consumeScheduledMedicationNotificationContext,
    watchEventsReady,
    notificationEventsReady,
  });

  document.documentElement.dataset.mmRuntime = isNative ? 'native' : 'web';
  document.documentElement.dataset.mmPlatform = platform;

  // A instalação na Tela de Início pertence somente ao WebApp/PWA.
  // No app Capacitor, remova também os nós do DOM: isso evita depender
  // exclusivamente de CSS/ordem de carregamento para esconder a opção.
  if (isNative) {
    document.querySelectorAll?.('.install-group, #installSheet')?.forEach(node => node.remove());
  }
})();
