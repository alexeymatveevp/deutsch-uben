/** Screens reachable from the side drawer, in display order. */
export const PAGES = [
  { label: 'Все карточки', path: '/' },
  { label: 'Квиз', path: '/quiz' },
  { label: 'Посмотреть сегодня', path: '/learning' },
  { label: 'В обучении', path: '/studying' },
  { label: 'Выражения', path: '/expressions' },
  { label: 'Избранное', path: '/favorites' },
] as const

export type PagePath = (typeof PAGES)[number]['path']

export function pageFor(pathname: string) {
  return PAGES.find((p) => p.path === pathname) ?? PAGES[0]
}
