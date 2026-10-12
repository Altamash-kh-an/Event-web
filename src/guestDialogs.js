let activeDialogCleanup = null

function openDialog({ title = 'Event-Album', message, input, confirmLabel = 'CONFIRM', cancelLabel = 'CANCEL' }) {
  activeDialogCleanup?.(false)

  return new Promise((resolve) => {
    const backdrop = document.createElement('div')
    backdrop.className = 'guest-dialog-backdrop'
    backdrop.innerHTML = `<div class="guest-dialog" role="dialog" aria-modal="true" aria-labelledby="guest-dialog-title"><button class="guest-dialog-close" type="button" aria-label="Cancel">×</button><p class="guest-dialog-kicker">Event-Album</p><h2 id="guest-dialog-title">${title}</h2><p class="guest-dialog-message">${message}</p>${input ? `<label class="guest-dialog-label" for="guest-dialog-input">${input.label}</label><textarea id="guest-dialog-input" maxlength="${input.maxLength}" placeholder="${input.placeholder}"></textarea>` : ''}<div class="guest-dialog-actions"><button class="guest-dialog-cancel" type="button">${cancelLabel}</button><button class="guest-dialog-confirm" type="button">${confirmLabel}</button></div></div>`
    const dialog = backdrop.firstElementChild
    const textarea = dialog.querySelector('#guest-dialog-input')
    const finish = (value) => {
      activeDialogCleanup = null
      document.removeEventListener('keydown', onKeyDown)
      backdrop.remove()
      resolve(value)
    }
    const onKeyDown = (event) => {
      if (event.key === 'Escape') finish(input ? null : false)
    }
    activeDialogCleanup = (value) => finish(value)
    dialog.querySelector('.guest-dialog-close').addEventListener('click', () => finish(input ? null : false))
    dialog.querySelector('.guest-dialog-cancel').addEventListener('click', () => finish(input ? null : false))
    dialog.querySelector('.guest-dialog-confirm').addEventListener('click', () => finish(input ? textarea.value.trim() : true))
    backdrop.addEventListener('click', (event) => { if (event.target === backdrop) finish(input ? null : false) })
    document.addEventListener('keydown', onKeyDown)
    document.body.appendChild(backdrop)
    if (textarea) textarea.focus()
    else dialog.querySelector('.guest-dialog-confirm').focus()
  })
}

export function showGuestWishDialog({ label, placeholder, maxLength }) {
  return openDialog({
    title: 'Share a wedding wish',
    message: 'Add an optional note to include with this memory.',
    input: { label, placeholder, maxLength },
    confirmLabel: 'USE THIS WISH',
  })
}

export function showGuestConfirm(message, confirmLabel = 'CONFIRM') {
  return openDialog({ message, confirmLabel })
}
