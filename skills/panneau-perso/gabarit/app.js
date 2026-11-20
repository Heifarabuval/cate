/* global document */
// Le JavaScript du panneau. Cate interdit les scripts en ligne et les gestionnaires
// onclick="..." : tout passe par ce fichier et par addEventListener.
const go = document.getElementById('go')
const status = document.getElementById('status')

go.addEventListener('click', () => {
  status.replaceChildren()
  const pill = document.createElement('span')
  pill.className = 'pill ok'
  pill.textContent = 'Action lancée'
  status.append(pill)
})
