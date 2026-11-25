/** Offline fixture API shared by the preview generator, Playwright checks and component tests. */
export function previewFixtures(origin: string): (path: string, query: URLSearchParams) => { data: any; pagination?: any };
