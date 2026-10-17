import type { VodKey } from '@/types/constants'

import { defineContentScript } from '#imports'
import { MATCHES } from '@/constants/matches'
import { checkVodEnable } from '@/utils/extension/checkVodEnable'
import { NCOPatcher } from '@/ncoverlay/patcher'

import './style.css'

const vod: VodKey = 'jellyfin'
const videoSelector = '.videoPlayerContainer video, #videoPlayer, video#htmlvideoplayer'

function jellyfinPage(): boolean {
  // Avoid activating on unrelated sites despite the wildcard host match.
  return Boolean(
    document.querySelector('meta[name="application-name"][content*="Jellyfin" i]') ||
    document.querySelector('link[href*="jellyfin"]') ||
    document.querySelector('.skinHeader, .mainDrawer, .dashboardDocument')
      && (document.querySelector('#jellyfinCss') || document.querySelector('.emby-tabs'))
      && location.pathname.includes('/web')
  )
}

function playerVideo(): HTMLVideoElement | null {
  return [...document.querySelectorAll<HTMLVideoElement>(videoSelector)]
    .find(v => v.isConnected && v.getBoundingClientRect().width > 100) ?? null
}

export default defineContentScript({
  matches: MATCHES[vod],
  runAt: 'document_idle',
  main: () => void main(),
})

async function main() {
  if (!(await checkVodEnable(vod))) return
  // Jellyfin is an SPA, and its video element appears only after playback begins.
  // Restrict detection to Jellyfin web paths to avoid inspecting videos on other sites.
  if (!location.pathname.includes('/web')) return

  let patcher: NCOPatcher | null = null
  let busy = false

  const scan = async () => {
    if (busy) return
    busy = true
    try {
      if (!jellyfinPage()) return

      const video = playerVideo()
      if (!video) {
        if (patcher?.nco) await patcher.dispose()
        return
      }
      if (!patcher) {
        patcher = new NCOPatcher(vod, {
          getInfo: async (nco) => {
            // Jellyfin's .itemName may contain only "Season 1 - 1. Episode".
            // Prefer both show title and episode label for comment matching.
            const series = document.querySelector<HTMLElement>('.parentName')?.textContent?.trim()
            const episode = document.querySelector<HTMLElement>('.itemName')?.textContent?.trim()
            const pageTitle = document.title
              .replace(/\s*\(\d{4}\)\s*$/, '')
              .replace(/\s*[-|]\s*Jellyfin\s*$/i, '')
              .trim()
            const match = episode?.match(/^Season\s+(\d+)\s*-\s*(\d+)\.\s*(.*)$/i)
            const title = series && match
              ? `${series} Season ${match[1]} 第${match[2]}話 ${match[3]}`.trim()
              : series && episode ? `${series} ${episode}` : pageTitle
            return title ? { input: title, duration: nco.video.duration || 0 } : null
          },
          appendCanvas: (target, canvas) => {
            const parent = target.parentElement
            if (!parent) return
            parent.classList.add('NCOverlay-Jellyfin-VideoParent')
            target.insertAdjacentElement('afterend', canvas)
          },
        })
      }
      await patcher.setVideo(video)
    } finally {
      busy = false
    }
  }

  const observer = new MutationObserver(() => void scan())
  observer.observe(document.documentElement, { childList: true, subtree: true })
  void scan()
}
