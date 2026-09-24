// Verifica sessão antes de renderizar a página; redireciona pro login se necessário.
window.CURRENT_USER = null;

async function requireSession() {
  try {
    const res = await fetch('api/auth/me');
    if (!res.ok) throw new Error();
    const user = await res.json();
    window.CURRENT_USER = user;
    const adminLink = document.getElementById('adminLink');
    if (adminLink && user.isAdmin) adminLink.style.display = 'block';
    return user;
  } catch {
    window.location.href = 'login.html';
    throw new Error('redirecting');
  }
}

// Versão que NÃO redireciona — usada em páginas públicas (portfólio, vídeo/álbum públicos)
async function trySession() {
  try {
    const res = await fetch('api/auth/me');
    if (!res.ok) throw new Error();
    const user = await res.json();
    window.CURRENT_USER = user;
    const adminLink = document.getElementById('adminLink');
    if (adminLink && user.isAdmin) adminLink.style.display = 'block';
    return user;
  } catch {
    window.CURRENT_USER = null;
    return null;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      const client = await window.studioReady;
      if (client) await client.auth.signOut().catch(() => {});
      window.location.href = 'login.html';
    });
  }

  // Menu símbolo (☰) no topbar — abre/fecha o dropdown de navegação
  const menuToggle = document.getElementById('menuToggle');
  const menuDropdown = document.getElementById('menuDropdown');
  if (menuToggle && menuDropdown) {
    menuToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      menuDropdown.classList.toggle('open');
    });
    document.addEventListener('click', (e) => {
      if (!menuDropdown.contains(e.target) && e.target !== menuToggle) {
        menuDropdown.classList.remove('open');
      }
    });
  }
});
