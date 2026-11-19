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

const tabs = ["games", "members", "overdue"];

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
  const loader = tab === "games" ? loadGames : tab === "members" ? loadMembers : loadOverdue;
  await run(loader);
  await run(refreshOverdueBadge); // Met à jour la pastille du nombre d'emprunts en retard visible sans ouvrir l'onglet (FEAT-05)
}

window.addEventListener("hashchange", refresh);

// --- Jeux ------------------------------------------------------------------

// État des filtres actifs pour la recherche de jeux (FEAT-06)
let gameFilters = {};

function readPositiveInt(raw) {
  if (raw === null || raw === undefined) return null;
  const trimmed = String(raw).trim();
  if (!/^[1-9]\d*$/.test(trimmed)) return null;
  return Number(trimmed);
}

function getGameSearchFilters(form) {
  const data = new FormData(form);
  const filters = {};
  const q = String(data.get("q") ?? "").trim();
  const players = readPositiveInt(data.get("players"));
  const maxDuration = readPositiveInt(data.get("maxDuration"));
  if (q) filters.q = q;
  if (players !== null) filters.players = players;
  if (maxDuration !== null) filters.maxDuration = maxDuration;
  const availableOnly = Boolean(form.querySelector('input[name="availableOnly"]')?.checked); // Inclut le filtre "disponibles uniquement" uniquement lorsqu'il est coché (FEAT-07)
  if (availableOnly) filters.available = true;
  return filters;
}
async function loadGames() {
  const hasActiveSearch = Object.keys(gameFilters).length > 0;
  const games = await api.listGames(gameFilters);
  $("#games-empty").hidden = hasActiveSearch || games.length > 0;
  $("#games-no-match").hidden = !hasActiveSearch || games.length > 0;
  $("#games-list").replaceChildren(...games.map(gameCard));
}

const gamesSearchForm = $("#games-search-form");
if (gamesSearchForm) {
  gamesSearchForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    gameFilters = getGameSearchFilters(gamesSearchForm);
    await run(loadGames);
  });
  $("#games-reset").addEventListener("click", async () => {
    gamesSearchForm.reset();
    gameFilters = {};
    await run(loadGames);
  });
  // Recharge la liste dès que l'utilisateur coche ou décoche "Disponibles uniquement" (FEAT-07)
  const availableCheckbox = gamesSearchForm.querySelector('input[name="availableOnly"]');
  if (availableCheckbox) {
    availableCheckbox.addEventListener("change", async () => {
      gameFilters = getGameSearchFilters(gamesSearchForm);
      await run(loadGames);
    });
  }
}

function gameCard(game) {
  const players =
    game.minPlayers === game.maxPlayers ? `${game.minPlayers}` : `${game.minPlayers} à ${game.maxPlayers}`;
  const status = game.isAvailable
    ? el("span", { class: "badge ok" }, "Disponible")
    : el("span", { class: "badge busy" }, "Emprunté");
  
  // Boutons d'action de la carte : emprunter ou rendre (FEAT-03), modifier ou supprimer (FEAT-01)
  const actions = el("div", { class: "actions" });
  if (game.isAvailable) {
    actions.append(button("Emprunter", () => openBorrowDialog(game), "primary"));
  } else {
    actions.append(button("Rendre", () => returnGame(game), "primary"));
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

async function returnGame(game) { // Retrouve l'emprunt en cours d'un jeu parmi les adhérents et enregistre son retour (FEAT-03)
  await run(async () => {
    const members = await api.listMembers();
    let activeLoan = null;
    for (const member of members) {
      const loans = await api.listMemberLoans(member.id);
      activeLoan = loans.find((loan) => loan.gameID === game.id && !loan.returnedAt);
      if (activeLoan) break;
    }
    if (!activeLoan) {
      toast("Aucun emprunt en cours trouvé pour ce jeu.", true);
      return;
    }
    await api.returnLoan(activeLoan.id);
    toast(`« ${game.title} » a été rendu.`);
    await refresh();
  });
}

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
    button("Emprunts", () => openMemberLoansDialog(member)),
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

// Affiche la liste des emprunts d'un adhérent avec titre du jeu, dates et état (FEAT-04)
const memberLoansDialog = $("#member-loans-dialog");

async function openMemberLoansDialog(member) {
  await run(async () => {
    const [loans, games] = await Promise.all([
      api.listMemberLoans(member.id),
      api.listGames(),
    ]);
    const gamesByID = new Map(games.map((g) => [g.id, g.title]));
    $("#member-loans-title").textContent = `Emprunts de ${member.name}`;
    const container = $("#member-loans-content");
    container.replaceChildren();

    if (loans.length === 0) {
      container.append(el("p", { class: "empty" }, "Aucun emprunt pour le moment."));
    } else {
      const now = Date.now();
      const list = el("ul", { class: "list" });
      for (const loan of loans) {
        const title = gamesByID.get(loan.gameID) ?? "Jeu inconnu";
        let statusLabel = "En cours";
        let badgeClass = "badge busy";
        if (loan.returnedAt) {
          statusLabel = "Rendu";
          badgeClass = "badge ok";
        } else if (new Date(loan.dueAt).getTime() < now) {
          statusLabel = "En retard";
          badgeClass = "badge danger";
        }
        list.append(
          el(
            "li",
            { class: "row" },
            el(
              "div",
              {},
              el("strong", {}, title),
              el("div", { class: "meta" }, `Emprunté le ${formatDate(loan.borrowedAt)} · À rendre avant le ${formatDate(loan.dueAt)}`),
            ),
            el("span", { class: badgeClass }, statusLabel),
          ),
        );
      }
      container.append(list);
    }
    memberLoansDialog.showModal();
  });
}
// Met à jour l'indicateur du nombre d'emprunts en retard dans la barre de navigation (FEAT-05)
async function refreshOverdueBadge() {
  const overdue = await api.listOverdueLoans();
  const badge = $("#overdue-count");
  if (!badge) return;
  badge.textContent = String(overdue.length);
  badge.hidden = overdue.length === 0;
}

// Affiche la liste des emprunts en retard avec jeu, adhérent, date limite et jours de retard (FEAT-05)
async function loadOverdue() {
  const [overdueLoans, games, members] = await Promise.all([
    api.listOverdueLoans(),
    api.listGames(),
    api.listMembers(),
  ]);
  const gamesByID = new Map(games.map((g) => [g.id, g.title]));
  const membersByID = new Map(members.map((m) => [m.id, m.name]));
  const list = $("#overdue-list");
  const empty = $("#overdue-empty");
  list.replaceChildren();

  if (overdueLoans.length === 0) {
    empty.hidden = false;
    return;
  }
  empty.hidden = true;
  const now = Date.now();
  for (const loan of overdueLoans) {
    const gameTitle = gamesByID.get(loan.gameID) ?? "Jeu inconnu";
    const memberName = membersByID.get(loan.memberID) ?? "Adhérent·e inconnu·e";
    const daysLate = Math.max(1, Math.floor((now - new Date(loan.dueAt).getTime()) / 86400_000));
    list.append(
      el(
        "li",
        { class: "row" },
        el(
          "div",
          { class: "row-main" },
          el("p", {}, el("strong", {}, gameTitle)),
          el(
            "p",
            { class: "meta" },
            `Adhérent·e : ${memberName} · À rendre avant le ${formatDate(loan.dueAt)}`,
          ),
        ),
        el("span", { class: "badge danger" }, `En retard · ${daysLate} j de retard`),
      ),
    );
  }
}
refresh();
