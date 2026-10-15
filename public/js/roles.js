// The kinds of housemate you can add. Shared by the game (for the Add panel and
// badges) and the server (src/npcs.js, which gives each one their routine).
export const ROLE_INFO = {
  animator: { emoji: '🎨', title: 'Animator', about: 'Works at the desk, sketching frames.' },
  chef: { emoji: '🍳', title: 'Chef', about: 'Hangs around the dining table, always cooking something.' },
  gamer: { emoji: '🎮', title: 'Gamer', about: 'Usually on the couch in front of the TV.' },
  sleepy: { emoji: '😴', title: 'Sleepy roommate', about: 'Takes naps anywhere, but loves the bed.' },
  plants: { emoji: '🌿', title: 'Plant lover', about: 'Goes from plant to plant, watering them.' },
  bookworm: { emoji: '📚', title: 'Bookworm', about: 'Reads by the bookshelves and on the couch.' },
};
