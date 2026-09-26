import { useState, type KeyboardEvent, type ReactNode } from 'react'

import { inputStyle, linkButtonStyle, primaryButtonStyle } from './ui'

type Props = {
  value: string | null
  editable: boolean
  // Dashed prompt shown instead of an empty value you can edit.
  prompt: string
  placeholder?: string
  maxLength: number
  multiline?: boolean
  required?: boolean
  // Resolves true when saved, so the editor can close.
  onSave: (value: string | null) => Promise<boolean>
  // How the value looks when not editing.
  children: ReactNode
}

// Click the thing to edit the thing. Enter (Ctrl/Cmd+Enter when multiline) saves, Esc cancels.
export default function InlineEdit({
  value,
  editable,
  prompt,
  placeholder,
  maxLength,
  multiline = false,
  required = false,
  onSave,
  children,
}: Props) {
  const [draft, setDraft] = useState<string | null>(null)

  if (draft === null) {
    if (!editable) {
      return value ? children : null
    }

    if (!value) {
      return (
        <button className="bio-empty" onClick={() => setDraft('')}>
          {prompt}
        </button>
      )
    }

    return (
      <div
        className="editable"
        role="button"
        tabIndex={0}
        title="Click to edit"
        onClick={() => setDraft(value)}
        onKeyDown={(event) => event.key === 'Enter' && setDraft(value)}
      >
        {children}
      </div>
    )
  }

  const trimmed = draft.trim()
  const canSave = !required || trimmed !== ''

  async function commit() {
    if (!canSave) {
      return
    }

    if (trimmed === (value ?? '') || (await onSave(trimmed || null))) {
      setDraft(null)
    }
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      // Keep the global Esc handler from also closing the panel.
      event.stopPropagation()
      setDraft(null)
    } else if (event.key === 'Enter' && (!multiline || event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      commit()
    }
  }

  const fieldProps = {
    autoFocus: true,
    value: draft,
    placeholder,
    maxLength,
    onKeyDown: handleKeyDown,
    style: { ...inputStyle, marginBottom: '4px', fontSize: multiline ? '14px' : '16px' },
  }

  return (
    <div style={{ margin: '4px 0 8px' }}>
      {multiline ? (
        <textarea
          {...fieldProps}
          rows={4}
          onChange={(event) => setDraft(event.target.value)}
          style={{ ...fieldProps.style, resize: 'vertical' }}
        />
      ) : (
        <input {...fieldProps} onChange={(event) => setDraft(event.target.value)} />
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span className="row-meta" style={{ flex: 1, margin: 0 }}>
          {multiline ? `${draft.length}/${maxLength} · Ctrl+Enter to save` : 'Enter to save · Esc to cancel'}
        </span>
        <button type="button" onClick={() => setDraft(null)} style={{ ...linkButtonStyle, fontSize: '13px' }}>
          Cancel
        </button>
        <button
          type="button"
          onClick={commit}
          disabled={!canSave}
          style={{ ...primaryButtonStyle(canSave), flex: 'none', padding: '7px 14px', fontSize: '14px' }}
        >
          Save
        </button>
      </div>
    </div>
  )
}
