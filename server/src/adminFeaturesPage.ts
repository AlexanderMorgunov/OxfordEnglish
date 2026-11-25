export const featureFormStyles = `
  #features { min-width: 0; }
  #features fieldset { min-width: 0; margin: 12px 0; }
  #features label { display: block; margin: 6px 0; }
  #features button { margin: 3px 4px 3px 0; }
  #features li { overflow-wrap: anywhere; }
  #features input:focus-visible, #features button:focus-visible { outline: 2px solid #57c9bd; outline-offset: 2px; }
`;

export const featureForm = `
<fieldset id="features" lang="ru"><legend>Функции · Каталог игр</legend>
  <p id="feature-current">Введите токен, чтобы загрузить настройки.</p>
  <p id="feature-readiness" hidden>Игровой модуль или каталог ещё не настроен на сервере.</p>
  <form id="feature-form">
    <fieldset id="feature-fields" disabled>
      <legend>Режим после сохранения</legend>
      <label><input type="radio" name="feature-mode" value="off" checked> Выключена</label>
      <label><input type="radio" name="feature-mode" value="testing"> Тестирование</label>
      <label><input type="radio" name="feature-mode" value="public"> Открыта всем</label>
      <p id="feature-audience"></p>
      <label><input type="checkbox" id="feature-android"> Также открыть в приложении Android</label>
      <p id="feature-platforms"></p>
      <label for="feature-id">ID аккаунта тестировщика</label>
      <input id="feature-id" autocomplete="off" maxlength="256" aria-describedby="feature-id-error">
      <button id="feature-add" type="button">Добавить в список</button>
      <p id="feature-id-error" class="bad" role="alert"></p>
      <ul id="feature-testers" aria-label="Тестировщики"></ul>
      <button id="feature-save" disabled>Сохранить изменения</button>
      <button id="feature-reset" type="button" disabled>Отменить изменения</button>
    </fieldset>
    <button id="feature-load" type="button">Обновить настройки функций</button>
    <p id="feature-status" role="status"></p>
  </form>
</fieldset>
`;

export const featureFormScript = `
  const featureURL = '/v1/admin/features';
  const featureForm = $('feature-form');
  const featureMode = featureForm.elements.namedItem('feature-mode');
  const featureInput = $('feature-id');
  const androidCheckbox = $('feature-android');
  const modeNames = { off: 'выключена', testing: 'тестирование', public: 'открыта всем' };
  const featureStatus = (message) => { $('feature-status').textContent = message; };
  let featureSaved = null;
  let featureIds = [];
  let featureBusy = false;
  let featureConflict = false;
  let featureGeneration = 0;
  const featureDirty = () => featureSaved !== null &&
    (featureMode.value !== featureSaved.settings.mode ||
      androidCheckbox.checked !== featureSaved.settings.androidEnabled ||
      JSON.stringify(featureIds) !== JSON.stringify(featureSaved.settings.testAccountIds));
  const featureHasDraft = () => featureDirty() || featureInput.value.trim() !== '';
  function featureInputError(message) {
    $('feature-id-error').textContent = message;
    featureInput.setAttribute('aria-invalid', String(Boolean(message)));
  }
  function updateFeatureControls() {
    const editable = Boolean(featureSaved) && !featureBusy;
    $('feature-fields').disabled = !editable;
    $('feature-load').disabled = !tok() || featureBusy;
    $('feature-save').disabled = !editable || featureConflict || !featureDirty() || Boolean(featureInput.value.trim());
    $('feature-reset').disabled = !editable || !featureHasDraft();
    const count = featureIds.length;
    const audience = {
      off: 'После сохранения игры будут закрыты для всех.',
      testing: count ? 'Доступ получат только тестировщики из списка (' + count + ').' : 'Список пуст. Игры будут закрыты для всех.',
      public: 'Доступ получат все, включая гостей.',
    };
    $('feature-audience').textContent = featureSaved ? audience[featureMode.value] : '';
    $('feature-platforms').textContent = featureSaved && featureMode.value !== 'off'
      ? (androidCheckbox.checked ? 'Сайт и приложение Android' : 'Только сайт')
      : '';
  }
  function renderFeatureIds() {
    $('feature-testers').replaceChildren(...featureIds.map((id) => {
      const row = document.createElement('li');
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = 'Удалить';
      remove.setAttribute('aria-label', 'Удалить тестировщика ' + id);
      remove.onclick = () => {
        featureIds = featureIds.filter((item) => item !== id);
        renderFeatureIds();
        featureInput.focus();
      };
      row.append(id + ' ', remove);
      return row;
    }));
    updateFeatureControls();
  }
  function resetFeatureDraft() {
    featureMode.value = featureSaved?.settings.mode ?? 'off';
    androidCheckbox.checked = featureSaved?.settings.androidEnabled ?? false;
    featureIds = [...(featureSaved?.settings.testAccountIds ?? [])];
    featureInput.value = '';
    featureInputError('');
    renderFeatureIds();
  }
  function showFeature(data) {
    featureSaved = data;
    featureConflict = false;
    const { mode, revision, updatedAt } = data.settings;
    const date = updatedAt === null ? '' : ' · ' + new Date(updatedAt).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }) + ' МСК';
    $('feature-current').textContent = 'Сохранённый режим: ' + modeNames[mode] + ' · версия ' + revision + date;
    $('feature-readiness').hidden = data.ready;
    resetFeatureDraft();
  }
  function resetFeatureAuth() {
    featureGeneration++;
    featureSaved = null;
    featureBusy = false;
    featureConflict = false;
    $('feature-current').textContent = 'Введите токен, чтобы загрузить настройки.';
    $('feature-readiness').hidden = true;
    resetFeatureDraft();
  }
  async function featureRequest(path, init, onResult, failure) {
    if (featureBusy || !tok()) return;
    const generation = featureGeneration;
    featureBusy = true;
    updateFeatureControls();
    try {
      const response = await api(featureURL + path, { ...init, cache: 'no-store', signal: AbortSignal.timeout(10000) });
      const data = await response.json();
      if (generation !== featureGeneration) return;
      if (response.status === 401) {
        sessionStorage.removeItem(KEY);
        resetFeatureAuth();
        featureStatus('Токен не принят. Введите действующий токен.');
        return;
      }
      onResult(response, data);
    } catch {
      if (generation === featureGeneration) featureStatus(failure);
    } finally {
      if (generation === featureGeneration) {
        featureBusy = false;
        updateFeatureControls();
      }
    }
  }
  function loadFeatures() {
    featureStatus('Загружаем настройки…');
    return featureRequest('', {}, (response, data) => {
      if (!response.ok) throw new Error();
      const game = data.features.find((item) => item.key === 'games_catalog');
      if (!game) throw new Error();
      showFeature(game);
      featureStatus('Настройки загружены.');
    }, 'Не удалось загрузить настройки. Повторите попытку.');
  }
  $('feature-load').onclick = () => {
    if (!featureHasDraft() || confirm('Загрузить сохранённые настройки и сбросить черновик?')) loadFeatures();
  };
  $('feature-reset').onclick = () => { resetFeatureDraft(); featureStatus('Черновик сброшен.'); };
  featureForm.onchange = updateFeatureControls;
  featureInput.oninput = () => { featureInputError(''); updateFeatureControls(); };
  featureInput.onkeydown = (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      $('feature-add').click();
    }
  };
  $('feature-add').onclick = () => {
    const id = featureInput.value.trim();
    if (!featureSaved || featureBusy) return;
    if (id.length < 16 || id.length > 256) return featureInputError('Проверьте ID аккаунта.');
    if (featureIds.includes(id)) return featureInputError('Этот аккаунт уже есть в списке.');
    if (featureIds.length >= 100) return featureInputError('В списке может быть до 100 аккаунтов.');
    featureInputError('');
    featureStatus('Проверяем аккаунт…');
    void featureRequest('/games_catalog/check-account', {
      method: 'POST', body: JSON.stringify({ accountId: id }),
    }, (response) => {
      if (response.status === 404) {
        featureStatus('');
        return featureInputError('Аккаунт с таким ID не найден.');
      }
      if (!response.ok) throw new Error();
      featureIds.push(id);
      featureInput.value = '';
      renderFeatureIds();
      featureStatus('Аккаунт добавлен в черновик. Сохраните изменения.');
    }, 'Не удалось проверить аккаунт. Повторите попытку.').then(() => featureInput.focus());
  };
  featureForm.onsubmit = (event) => {
    event.preventDefault();
    if ($('feature-save').disabled || !featureSaved) return;
    const mode = featureMode.value;
    if ((mode !== featureSaved.settings.mode && mode !== 'testing') ||
        (mode === 'public' && androidCheckbox.checked && !featureSaved.settings.androidEnabled)) {
      const question = mode === 'public'
        ? (androidCheckbox.checked ? 'Открыть игры всем на сайте и в Android?' : 'Открыть игры всем на сайте?')
        : 'Закрыть доступ к каталогу игр для всех?';
      if (!confirm(question)) return;
    }
    featureStatus('Сохраняем изменения…');
    void featureRequest('/games_catalog', {
      method: 'POST',
      body: JSON.stringify({ mode, androidEnabled: androidCheckbox.checked, testAccountIds: featureIds, expectedRevision: featureSaved.settings.revision }),
    }, (response, data) => {
      if (response.status === 409) {
        featureConflict = true;
        return featureStatus('Настройки изменились в другой вкладке. Обновите их перед сохранением.');
      }
      if (data.error === 'no_such_account') {
        featureInputError('Удалите из черновика аккаунт, которого больше нет: ' + data.accountId);
        return featureStatus('Изменения не сохранены.');
      }
      if (!response.ok) throw new Error();
      showFeature(data);
      featureStatus('Изменения сохранены.');
    }, 'Не удалось сохранить изменения. Проверьте соединение и повторите попытку.');
  };
  window.addEventListener('beforeunload', (event) => {
    if (!featureHasDraft()) return;
    event.preventDefault();
    event.returnValue = '';
  });
  updateFeatureControls();
  if (tok()) loadFeatures();
`;
