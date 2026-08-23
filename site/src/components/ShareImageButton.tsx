import { useState } from 'react'

type ShareImageButtonProps = {
  createImage: () => Promise<Blob>
  filename: string
  shareTitle: string
  shareText: string
  disabled?: boolean
  label?: string
  className?: string
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
}

export default function ShareImageButton({
  createImage,
  filename,
  shareTitle,
  shareText,
  disabled = false,
  label = 'Share image',
  className = '',
}: ShareImageButtonProps) {
  const [status, setStatus] = useState('')
  const [working, setWorking] = useState(false)

  const share = async () => {
    if (working || disabled) return
    setWorking(true)
    setStatus('Generating image…')

    try {
      const blob = await createImage()
      const file = new File([blob], filename, { type: 'image/png' })

      const nativeFileShare = navigator.maxTouchPoints > 0
        && typeof navigator.share === 'function'
        && typeof navigator.canShare === 'function'
        && navigator.canShare({ files: [file] })
      if (nativeFileShare) {
        try {
          setStatus('Opening share sheet…')
          await navigator.share({ files: [file], title: shareTitle, text: shareText })
          setStatus('Image shared')
          return
        } catch (error) {
          if (error instanceof DOMException && error.name === 'AbortError') {
            setStatus('')
            return
          }
        }
      }

      if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
        try {
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
          setStatus('Image copied — ready to paste')
          return
        } catch {
          // A download remains available in browsers that block image clipboard writes.
        }
      }

      downloadBlob(blob, filename)
      setStatus('PNG downloaded')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Image export failed')
    } finally {
      setWorking(false)
    }
  }

  return (
    <span className={`share-image-control ${className}`.trim()}>
      <button
        type="button"
        onClick={share}
        disabled={disabled || working}
        title="Creates a branded PNG with its source and marginaltoken.com inside the image"
      >
        <span aria-hidden="true">↗</span>
        {working ? 'Making image…' : label}
      </button>
      <small aria-live="polite">{status}</small>
    </span>
  )
}
