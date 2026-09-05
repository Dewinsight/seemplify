import Image, { type ImageProps } from 'next/image'

type ThemedImageProps = Omit<ImageProps, 'src'> & {
  /** Light-theme source. */
  src: string
  /** Dark-theme source; defaults to `<src>-dark.<ext>` next to the light file. */
  darkSrc?: string
}

function defaultDarkSrc(src: string) {
  return src.replace(/(\.[a-z0-9]+)$/i, '-dark$1')
}

/**
 * Renders the light and dark captures of a screen and lets CSS pick one from
 * `data-theme`, so the swap is instant on toggle and there is no hydration flash.
 * The hidden variant is never prioritised.
 */
export default function ThemedImage({ src, darkSrc = defaultDarkSrc(src), className = '', priority, ...props }: ThemedImageProps) {
  return (
    <>
      <Image {...props} src={src} className={`${className} marketing-theme-light-only`.trim()} priority={priority} />
      <Image {...props} src={darkSrc} className={`${className} marketing-theme-dark-only`.trim()} loading="lazy" />
    </>
  )
}
