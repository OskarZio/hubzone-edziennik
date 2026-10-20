/* Fills administrator details on the privacy policy page from config.js (HZ_LEGAL). */
(function(){
  "use strict";
  if (window.top !== window.self){ document.documentElement.style.display = "none"; return; }
  const L = window.HZ_LEGAL || {};
  const set = (key, val) => document.querySelectorAll(`[data-legal="${key}"]`).forEach(n => { n.textContent = val; });
  if (L.controller) set("controller", L.controller);
  if (L.updated) set("updated", L.updated);
  const email = L.email && !/UZUPELNIJ/i.test(L.email) ? L.email : "adres e-mail trenera (podany na zajęciach)";
  set("email", email);
  if (L.address) set("address-wrap", ", " + L.address);
  try { const t = JSON.parse(localStorage.getItem("hz-theme")); if (t && t.mode && t.mode !== "auto") document.documentElement.setAttribute("data-theme", t.mode); } catch(e){}
})();
