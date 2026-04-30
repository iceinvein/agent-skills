const server = Bun.serve({
  port: 3000,
  fetch(req) {
    return new Response("hello");
  },
});

console.log(`Listening on ${server.port}`);
