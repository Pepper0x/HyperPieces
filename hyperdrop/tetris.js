
function startGame() {
  document.getElementById('start-screen').style.display = 'none';
}

function showLeaderboard() {
  document.getElementById('start-screen').style.display = 'none';
  document.getElementById('leaderboard-screen').style.display = 'flex';
}

function goToMenu() {
  document.getElementById('leaderboard-screen').style.display = 'none';
  document.getElementById('start-screen').style.display = 'flex';
}
