// Every path in the app, named once. Pages and links import from here.
export const ROUTES = {
  login: '/login',
  visits: '/',
  newVisit: '/visits/new',
  visit: (id: string) => `/visits/${id}`,
  sync: '/sync',
  ops: '/ops',
} as const;
