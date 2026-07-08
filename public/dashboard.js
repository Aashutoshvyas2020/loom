const csrf = document.querySelector('meta[name="loom-csrf"]')?.getAttribute('content');
const statusElement = document.querySelector('#runtime-status');
const connectionElement = document.querySelector('#connection-state');
const actionResult = document.querySelector('#action-result');
const refreshButton = document.querySelector('#refresh-status');
const configInput = document.querySelector('#config-json');
const saveConfigButton = document.querySelector('#save-config');

function requireElement(element, label) {
  if (element === null) {
    throw new Error(`Missing dashboard element: ${label}`);
  }
  return element;
}

function setBusy(button, busy) {
  button.disabled = busy;
  button.setAttribute('aria-busy', busy ? 'true' : 'false');
}

async function readJson(response) {
  const text = await response.text();
  if (text === '') {
    return {};
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Unexpected dashboard response (${response.status}).`);
  }
}

async function refreshStatus() {
  const status = requireElement(statusElement, 'runtime-status');
  const connection = requireElement(connectionElement, 'connection-state');
  try {
    const response = await fetch('/api/status', {
      credentials: 'same-origin',
      headers: { accept: 'application/json' },
    });
    const body = await readJson(response);
    if (!response.ok) {
      throw new Error(typeof body.error === 'string' ? body.error : 'Unable to load status.');
    }
    status.textContent = JSON.stringify(body, null, 2);
    connection.textContent = 'Connected to local Loom runtime';
  } catch (error) {
    connection.textContent = 'Dashboard connection failed';
    status.textContent = error instanceof Error ? error.message : String(error);
  }
}

async function invokeAction(action, body) {
  if (typeof csrf !== 'string' || csrf.length === 0) {
    throw new Error('Dashboard CSRF token is unavailable.');
  }
  const response = await fetch(`/api/actions/${encodeURIComponent(action)}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-loom-csrf': csrf,
    },
    body: JSON.stringify(body ?? {}),
  });
  const result = await readJson(response);
  if (!response.ok) {
    throw new Error(typeof result.error === 'string' ? result.error : `Action failed (${response.status}).`);
  }
  return result;
}

for (const button of document.querySelectorAll('button[data-action]')) {
  button.addEventListener('click', async () => {
    const action = button.getAttribute('data-action');
    if (action === null) {
      return;
    }
    const result = requireElement(actionResult, 'action-result');
    setBusy(button, true);
    result.textContent = `Running ${action}…`;
    try {
      await invokeAction(action, {});
      result.textContent = `${action} completed.`;
      if (action !== 'stop_loom') {
        await refreshStatus();
      }
    } catch (error) {
      result.textContent = error instanceof Error ? error.message : String(error);
    } finally {
      setBusy(button, false);
    }
  });
}

requireElement(refreshButton, 'refresh-status').addEventListener('click', async () => {
  const button = requireElement(refreshButton, 'refresh-status');
  setBusy(button, true);
  await refreshStatus();
  setBusy(button, false);
});

requireElement(saveConfigButton, 'save-config').addEventListener('click', async () => {
  const button = requireElement(saveConfigButton, 'save-config');
  const result = requireElement(actionResult, 'action-result');
  setBusy(button, true);
  try {
    const parsed = JSON.parse(requireElement(configInput, 'config-json').value);
    await invokeAction('update_config', parsed);
    result.textContent = 'Configuration saved for the next launch.';
  } catch (error) {
    result.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    setBusy(button, false);
  }
});

void refreshStatus();
