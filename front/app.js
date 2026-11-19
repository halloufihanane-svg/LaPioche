import { API_URL } from "./config.js";
import { api } from "./api.js";

const $ = (selector, root = document) => root.querySelector(selector);

$("#docs-link").href = API_URL;

const dateFormat = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long" });
const formatDate = (iso) => dateFormat.format(new Date(iso));

// Construit un élément sans jamais passer par innerHTML : les données de
// l'API (titres, noms) sont insérées comme du texte.
function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === "class") node.className = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value);
  }
  node.append(...children);
  return node;
}

function button(label, onClick, className = "") {
  return el("button", { type: "button", class: className, onclick: onClick }, label);
}

function toast(message, isError = false) {
  const node = el("p", { class: isError ? "toast error" : "toast" }, message);
  $("#toasts").append(node);
  setTimeout(() => node.remove(), 5000);
}

// Exécute une action déclenchée par un bouton et affiche l'erreur de l'API.
async function run(action) {
  try {
    await action();
  } catch (error) {
    toast(error.message, true);
  }
}

function showFormError(dialog, error) {
  const target = $(".form-error", dialog);
  target.textContent = error ? error.message : "";
  target.hidden = !error;
}

for (const cancel of document.querySelectorAll("[data-cancel]")) {
  cancel.addEventListener("click", () => cancel.closest("dialog").close());
}

// Branche un formulaire de boîte de dialogue sur un appel à l'API.
// L'erreur renvoyée par l'API reste affichée dans la boîte, qui ne se ferme
// qu'en cas de succès.
function bindSubmit(dialog, form, handler) {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    showFormError(dialog, null);
    try {
      await handler(new FormData(form));
      dialog.close();
      await refresh();
    } catch (error) {
      showFormError(dialog, error);
    }
  });
}
// Ouvre la boîte de confirmation avant une suppression (FEAT-01).
const confirmDialog = $("#confirm-dialog");
const confirmForm = $("#confirm-form");
let confirmHandler = null;

function askConfirm(message, handler) {
  $("#confirm-message").textContent = message;
  showFormError(confirmDialog, null);
  confirmHandler = handler;
  confirmDialog.showModal();
}

bindSubmit(confirmDialog, confirmForm, async () => {
  if (confirmHandler) await confirmHandler();
});

// --- Onglets ---------------------------------------------------------------

const tabs = ["games", "members"];

function currentTab() {
  const name = location.hash.slice(1);
  return tabs.includes(name) ? name : "games";
}

async function refresh() {
  const tab = currentTab();
  for (const name of tabs) {
    $(`#${name}`).hidden = name !== tab;
    $(`[data-tab="${name}"]`).toggleAttribute("aria-current", name === tab);
  }
  await run(tab === "games" ? loadGames : loadMembers);
}

window.addEventListener("hashchange", refresh);

// --- Jeux ------------------------------------------------------------------

async function loadGames() {
  const games = await api.listGames();
  $("#games-empty").hidden = games.length > 0;
  $("#games-list").replaceChildren(...games.map(gameCard));
}

function gameCard(game) {
  const players =
    game.minPlayers === game.maxPlayers ? `${game.minPlayers}` : `${game.minPlayers} à ${game.maxPlayers}`;
  const status = game.isAvailable
    ? el("span", { class: "badge ok" }, "Disponible")
    : el("span", { class: "badge busy" }, "Emprunté");
  
  // Boutons d'action de la carte : emprunter (si disponible), modifier ou supprimer (FEAT-01)
  const actions = el("div", { class: "actions" });
  if (game.isAvailable) {
    actions.append(button("Emprunter", () => openBorrowDialog(game), "primary"));
  }
  actions.append(
    button("Modifier", () => openEditGameDialog(game)),
    button("Supprimer", () => askConfirm(
      `Supprimer définitivement le jeu « ${game.title} » ?`,
      () => api.deleteGame(game.id),
    ), "danger"),
  );

  return el(
    "li",
    { class: "card" },
    el("div", { class: "card-head" }, el("h3", {}, game.title), status),
    el("p", { class: "meta" }, `${players} joueur·ses · ${game.durationMinutes} min`),
    actions,
  );
}
// Modale unique pour créer un jeu (POST) ou modifier un jeu existant (PUT) (FEAT-01)
const gameDialog = $("#game-dialog");
const gameForm = $("#game-form");
let editingGame = null;

function openEditGameDialog(game) {
  editingGame = game;
  $("h2", gameDialog).textContent = "Modifier un jeu";
  gameForm.elements.title.value = game.title;
  gameForm.elements.minPlayers.value = game.minPlayers;
  gameForm.elements.maxPlayers.value = game.maxPlayers;
  gameForm.elements.durationMinutes.value = game.durationMinutes;
  showFormError(gameDialog, null);
  gameDialog.showModal();
}

$("#add-game").addEventListener("click", () => {
  editingGame = null;
  $("h2", gameDialog).textContent = "Ajouter un jeu";
  gameForm.reset();
  showFormError(gameDialog, null);
  gameDialog.showModal();
});

bindSubmit(gameDialog, gameForm, (data) => {
  const payload = {
    title: data.get("title").trim(),
    minPlayers: Number(data.get("minPlayers")),
    maxPlayers: Number(data.get("maxPlayers")),
    durationMinutes: Number(data.get("durationMinutes")),
  };
  return editingGame
    ? api.updateGame(editingGame.id, payload)
    : api.createGame(payload);
});

// --- Emprunts --------------------------------------------------------------

const borrowDialog = $("#borrow-dialog");
const borrowForm = $("#borrow-form");
let borrowedGame = null;

async function openBorrowDialog(game) {
  await run(async () => {
    const members = await api.listMembers();
    if (members.length === 0) {
      toast("Ajoutez d'abord un·e adhérent·e pour pouvoir emprunter.", true);
      return;
    }
    borrowedGame = game;
    $("#borrow-dialog-title").textContent = `Emprunter « ${game.title} »`;
    $("select", borrowForm).replaceChildren(
      ...members.map((member) => el("option", { value: member.id }, `${member.name} (${member.email})`)),
    );
    showFormError(borrowDialog, null);
    borrowDialog.showModal();
  });
}

bindSubmit(borrowDialog, borrowForm, async (data) => {
  const loan = await api.borrow(borrowedGame.id, data.get("memberID"));
  toast(`« ${borrowedGame.title} » emprunté, à rendre avant le ${formatDate(loan.dueAt)}.`);
});

// --- Adhérent·es -----------------------------------------------------------

async function loadMembers() {
  const members = await api.listMembers();
  $("#members-empty").hidden = members.length > 0;
  $("#members-list").replaceChildren(...members.map(memberRow));
}

let editingMember = null;

function openMemberDialog(member = null) {
  editingMember = member;
  memberForm.reset();
  showFormError(memberDialog, null);
  $("h2", memberDialog).textContent = member
    ? "Modifier l'adhérent·e"
    : "Ajouter un·e adhérent·e";
  if (member) {
    memberForm.elements.name.value = member.name;
    memberForm.elements.email.value = member.email;
  }
  memberDialog.showModal();
}

function memberRow(member) {
  const actions = el(
    "div",
    { class: "actions" },
    button("Modifier", () => openMemberDialog(member)),
    button(
      "Supprimer",
      () =>
        askConfirm(
          `Supprimer définitivement « ${member.name} » (${member.email}) ?`,
          () => api.deleteMember(member.id),
        ),
      "danger",
    ),
  );
  return el(
    "li",
    { class: "row" },
    el("div", { class: "row-main" }, el("p", {}, el("strong", {}, member.name)), el("p", { class: "meta" }, member.email)),
    actions,
  );
}

const memberDialog = $("#member-dialog");
const memberForm = $("#member-form");

$("#add-member").addEventListener("click", () => openMemberDialog());

bindSubmit(memberDialog, memberForm, (data) => {
  const payload = {
    name: data.get("name").trim(),
    email: data.get("email").trim(),
  };
  return editingMember
    ? api.updateMember(editingMember.id, payload)
    : api.createMember(payload);
});

refresh();
