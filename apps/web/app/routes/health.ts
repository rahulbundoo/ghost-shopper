export function loader() {
  return Response.json(
    { service: 'web', status: 'ok' },
    {
      headers: { 'Cache-Control': 'no-store' },
    },
  );
}
