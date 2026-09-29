});

test("rank card contains gamer-facing encouragement and Bobaks CTA", () => {
  const html = readHtml();

  assert.match(html, /Keep your crown shining/);
  assert.match(html, /flying up the leaderboard/);
  assert.ok(html.includes("Track this game on Bobaks Ranking"));
  assert.match(html, /location\.host/);
});
