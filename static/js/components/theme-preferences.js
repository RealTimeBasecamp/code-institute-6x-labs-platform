/**
 * Theme Preferences - click handlers for wizard theme/mode selection
 */
document.addEventListener('click', function(e) {
  // Theme card click
  const card = e.target.closest('.theme-card');
  if (card) {
    ThemeManager.changeTheme(card.dataset.theme);
    document.querySelectorAll('.theme-card').forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');
    const select = document.getElementById('id_theme');
    if (select) select.value = card.dataset.theme;
  }

  // Mode button click
  const btn = e.target.closest('.mode-btn');
  if (btn) {
    const mode = btn.dataset.mode;
    ThemeManager.applyMode(mode === 'system'
      ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : mode);
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const select = document.getElementById('id_theme_mode');
    if (select) select.value = mode;
  }
});
