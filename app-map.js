const DATA_URL = "app-data.json";

const state = {
  completedRoutes: [],
  plannedRoutes: [],
  generatedAt: "",
  filter: "all",
  query: "",
  view: "diary",
  map: null,
  markers: [],
  markerById: new Map(),
  selectedRouteId: "",
};

const els = {
  grid: document.querySelector("#routeGrid"),
  mapView: document.querySelector("#mapView"),
  routeMap: document.querySelector("#routeMap"),
  mapList: document.querySelector("#mapList"),
  empty: document.querySelector("#emptyState"),
  search: document.querySelector("#searchInput"),
  segments: [...document.querySelectorAll(".segment")],
  viewTabs: [...document.querySelectorAll(".view-tab")],
  refresh: document.querySelector("#refreshButton"),
  syncStatus: document.querySelector("#syncStatus"),
  dialog: document.querySelector("#routeDialog"),
  form: document.querySelector("#routeForm"),
  dialogTitle: document.querySelector("#dialogTitle"),
  closeDialog: document.querySelector("#closeDialogButton"),
  cancel: document.querySelector("#cancelButton"),
  id: document.querySelector("#routeId"),
  imagePreview: document.querySelector("#imagePreview"),
  readonlyDate: document.querySelector("#readonlyDate"),
  readonlyDistance: document.querySelector("#readonlyDistance"),
  readonlyUrl: document.querySelector("#readonlyUrl"),
  stars: document.querySelector("#ratingStars"),
  note: document.querySelector("#routeNote"),
  statRoutes: document.querySelector("#statRoutes"),
  statKm: document.querySelector("#statKm"),
  statRating: document.querySelector("#statRating"),
  statMissing: document.querySelector("#statMissing"),
  template: document.querySelector("#routeCardTemplate"),
};

async function loadExcelData({ silent = false } = {}) {
  try {
    const response = await fetch(`${DATA_URL}?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error("Data file not available");
    const data = await response.json();
    applySourceData(data);
    setSyncStatus(data.generatedAt ? `Excel: ${formatGeneratedAt(data.generatedAt)}` : "Excel načten");
    render();
  } catch {
    const initial = window.MUZY_INITIAL_DATA || { routes: [], plannedRoutes: [] };
    applySourceData(initial);
    if (!silent) setSyncStatus("Používám vložená data");
    render();
  }
}

async function checkForExcelUpdate() {
  try {
    const response = await fetch(`${DATA_URL}?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) return;
    const data = await response.json();
    if (data.generatedAt && data.generatedAt !== state.generatedAt) {
      applySourceData(data);
      setSyncStatus(`Excel: ${formatGeneratedAt(data.generatedAt)}`);
      render();
    }
  } catch {
    // The local watcher server avoids file:// fetch restrictions.
  }
}

function applySourceData(data) {
  state.generatedAt = data.generatedAt || state.generatedAt || "";
  state.completedRoutes = (data.routes || []).map((route) => normalizeRoute(route, "completed"));
  state.plannedRoutes = (data.plannedRoutes || []).map((route) => normalizeRoute(route, "planned"));
}

function normalizeRoute(route, fallbackStatus) {
  return {
    id: route.id || route.date || route.title,
    date: route.date || "",
    dateLabel: route.dateLabel || formatDate(route.date),
    title: route.title || "Nezadaná trasa",
    mapUrl: route.mapUrl || "",
    image: route.image || "",
    distanceKm: route.distanceKm === "" || route.distanceKm == null ? null : Number(route.distanceKm),
    rating: Number(route.rating || 0),
    note: route.note || "",
    tags: Array.isArray(route.tags) ? route.tags : [],
    start: route.start || null,
    sourceSheet: route.sourceSheet || "",
    status: route.status || fallbackStatus,
  };
}

function getActiveRoutes() {
  if (state.view === "planned") return state.plannedRoutes;
  return state.completedRoutes;
}

function getAllMapRoutes() {
  return [...state.completedRoutes, ...state.plannedRoutes].filter((route) => route.start);
}

function getFilteredMapRoutes() {
  return getAllMapRoutes().filter(routeMatchesFilters);
}

function routeNeedsInput(route) {
  if (route.status === "planned") return !route.mapUrl || !route.start;
  return !route.mapUrl || !route.image || !route.start;
}

function getFilteredRoutes() {
  return [...getActiveRoutes()]
    .sort((a, b) => {
      if (state.view === "planned") return a.title.localeCompare(b.title, "cs");
      return (b.date || "").localeCompare(a.date || "");
    })
    .filter(routeMatchesFilters);
}

function routeMatchesFilters(route) {
  if (state.filter === "missing" && !routeNeedsInput(route)) return false;
  const query = normalizeText(state.query);
  if (!query) return true;
  const haystack = normalizeText([
    route.title,
    route.dateLabel,
    route.note,
    route.mapUrl,
    route.tags.join(" "),
    route.status === "planned" ? "plánované planovane" : "prošlé prosle",
  ].join(" "));
  return haystack.includes(query);
}

function render() {
  renderStats();
  renderActiveView();
}

function renderStats() {
  const completed = state.completedRoutes;
  const planned = state.plannedRoutes;
  const totalKm = completed.reduce((sum, route) => sum + (Number(route.distanceKm) || 0), 0);
  const withDifficulty = completed.filter((route) => route.rating > 0);
  const averageDifficulty = withDifficulty.length
    ? (withDifficulty.reduce((sum, route) => sum + route.rating, 0) / withDifficulty.length).toFixed(1)
    : "-";

  els.statRoutes.textContent = `${completed.length} + ${planned.length}`;
  els.statKm.textContent = totalKm ? `${formatNumber(totalKm)} km` : "0 km";
  els.statRating.textContent = averageDifficulty;
  els.statMissing.textContent = [...completed, ...planned].filter(routeNeedsInput).length;
}

function renderActiveView() {
  const isMap = state.view === "map";
  els.grid.classList.toggle("is-hidden", isMap);
  els.mapView.classList.toggle("is-hidden", !isMap);
  els.empty.classList.add("is-hidden");

  if (isMap) {
    renderMap();
    return;
  }

  renderCards();
}

function renderCards() {
  const routes = getFilteredRoutes();
  els.grid.innerHTML = "";
  els.empty.classList.toggle("is-hidden", routes.length > 0);

  routes.forEach((route) => {
    const card = els.template.content.firstElementChild.cloneNode(true);
    if (route.status === "planned") card.classList.add("is-planned");

    const imageButton = card.querySelector(".route-image");
    imageButton.innerHTML = renderImage(route);
    imageButton.addEventListener("click", () => openDialog(route.id, route.status));

    card.querySelector(".date").textContent = route.status === "planned"
      ? "plánováno"
      : route.dateLabel || formatDate(route.date);
    card.querySelector(".distance").textContent = route.distanceKm ? `${formatNumber(route.distanceKm)} km` : "";
    card.querySelector("h2").textContent = route.title;
    card.querySelector(".card-stars").textContent = renderStars(route.rating);
    card.querySelector(".note").textContent = route.note || "Bez komentáře.";

    const tagRow = card.querySelector(".tag-row");
    tagRow.innerHTML = route.tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("");

    const missingRow = card.querySelector(".missing-row");
    missingRow.innerHTML = getMissingLabels(route)
      .map((label) => `<span class="missing-chip">${escapeHtml(label)}</span>`)
      .join("");

    const link = card.querySelector(".map-link");
    if (route.mapUrl) {
      link.href = route.mapUrl;
    } else {
      link.removeAttribute("href");
      link.classList.add("is-disabled");
      link.textContent = "Bez odkazu";
    }

    card.querySelector(".edit-button").textContent = "Detail";
    card.querySelector(".edit-button").addEventListener("click", () => openDialog(route.id, route.status));
    els.grid.append(card);
  });
}

function renderImage(route) {
  if (route.image) {
    return `<img src="${escapeAttribute(route.image)}" alt="Mapa trasy ${escapeAttribute(route.title)}">`;
  }
  const text = route.status === "planned" ? "Plánovaná trasa" : "Screenshot bude v Excelu";
  return `<div class="image-placeholder">${escapeHtml(text)}</div>`;
}

function renderStars(rating) {
  const value = Number(rating || 0);
  return Array.from({ length: 5 }, (_, index) => (index < value ? "★" : "☆")).join("");
}

function getMissingLabels(route) {
  const labels = [];
  if (!route.start) labels.push("chybí GPS start");
  if (!route.mapUrl) labels.push("chybí odkaz v Excelu");
  if (route.status === "completed" && !route.image) labels.push("chybí screenshot v Excelu");
  return labels;
}

function openDialog(routeId, status) {
  const source = status === "planned" ? state.plannedRoutes : state.completedRoutes;
  const route = source.find((item) => item.id === routeId);
  if (!route) return;

  els.id.value = route.id;
  els.dialogTitle.textContent = route.title;
  els.readonlyDate.textContent = route.status === "planned"
    ? "plánováno"
    : route.dateLabel || formatDate(route.date) || "-";
  els.readonlyDistance.textContent = route.distanceKm ? `${formatNumber(route.distanceKm)} km` : "není v Excelu";
  if (route.mapUrl) {
    els.readonlyUrl.href = route.mapUrl;
    els.readonlyUrl.textContent = "Otevřít trasu";
    els.readonlyUrl.classList.remove("is-disabled");
  } else {
    els.readonlyUrl.removeAttribute("href");
    els.readonlyUrl.textContent = "není v Excelu";
    els.readonlyUrl.classList.add("is-disabled");
  }
  els.note.value = route.note || "";
  renderImagePreview(route);
  renderRating(route.rating);
  els.dialog.showModal();
}

function closeDialog() {
  els.dialog.close();
}

function renderImagePreview(route) {
  els.imagePreview.innerHTML = route.image
    ? `<img src="${escapeAttribute(route.image)}" alt="Náhled screenshotu trasy">`
    : `<div class="image-placeholder">${route.status === "planned" ? "Plánovaná trasa bez screenshotu" : "Screenshot doplň v Excelu"}</div>`;
}

function renderRating(rating) {
  els.stars.innerHTML = "";
  const currentRating = Number(rating || 0);
  for (let value = 1; value <= 5; value += 1) {
    const star = document.createElement("span");
    star.textContent = value <= currentRating ? "★" : "☆";
    els.stars.append(star);
  }
}

function renderMap() {
  const routes = getFilteredMapRoutes();
  renderMapList(routes);
  els.empty.classList.toggle("is-hidden", routes.length > 0);

  if (!window.L) {
    els.routeMap.innerHTML = '<div class="image-placeholder">Mapové podklady se nepodařilo načíst.</div>';
    return;
  }

  if (!state.map) {
    state.map = L.map(els.routeMap, { scrollWheelZoom: true });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap",
    }).addTo(state.map);
  }

  state.markers.forEach((marker) => marker.remove());
  state.markers = [];
  state.markerById = new Map();

  const bounds = [];
  routes.forEach((route) => {
    const style = getMarkerStyle(route, route.id === state.selectedRouteId);
    const marker = L.circleMarker([route.start.lat, route.start.lng], {
      ...style,
    });
    marker.bindPopup(renderPopup(route));
    marker.on("click", () => selectMapRoute(route.id, { openPopup: false, panTo: false, scrollList: true }));
    marker.addTo(state.map);
    state.markers.push(marker);
    state.markerById.set(route.id, marker);
    bounds.push([route.start.lat, route.start.lng]);
  });

  if (state.selectedRouteId && !routes.some((route) => route.id === state.selectedRouteId)) {
    state.selectedRouteId = "";
  }

  if (bounds.length) {
    state.map.fitBounds(bounds, { padding: [28, 28], maxZoom: 12 });
  } else {
    state.map.setView([50.0755, 14.4378], 11);
  }

  setTimeout(() => state.map.invalidateSize(), 80);
  updateMapSelection();
}

function getMarkerStyle(route, selected = false) {
  const color = route.status === "planned" ? "#8A9390" : "#236247";
  return {
    radius: selected ? 12 : route.status === "planned" ? 7 : 8,
    color: selected ? "#B7791F" : color,
    fillColor: color,
    fillOpacity: route.status === "planned" ? 0.65 : 0.9,
    weight: selected ? 4 : 2,
  };
}

function renderPopup(route) {
  const status = route.status === "planned" ? "Plánovaná" : "Prošlá";
  const distance = route.distanceKm ? `${formatNumber(route.distanceKm)} km` : "";
  const link = route.mapUrl
    ? `<br><a href="${escapeAttribute(route.mapUrl)}" target="_blank" rel="noreferrer">Mapy.com</a>`
    : "";
  return `<strong>${escapeHtml(route.title)}</strong><br>${status}${distance ? ` · ${distance}` : ""}${link}`;
}

function renderMapList(routes) {
  els.mapList.innerHTML = routes
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === "completed" ? -1 : 1;
      return a.title.localeCompare(b.title, "cs");
    })
    .map((route) => {
      const label = route.status === "planned" ? "plánovaná" : "prošlá";
      const distance = route.distanceKm ? ` · ${formatNumber(route.distanceKm)} km` : "";
      return `
        <button class="map-item ${route.status === "planned" ? "is-planned" : ""}" type="button" data-route-id="${escapeAttribute(route.id)}">
          <strong>${escapeHtml(route.title)}</strong>
          <span>${label}${distance}</span>
        </button>
      `;
    })
    .join("");

  els.mapList.querySelectorAll(".map-item").forEach((item) => {
    item.addEventListener("click", () => {
      selectMapRoute(item.dataset.routeId, { openPopup: true, panTo: true, scrollList: false });
    });
  });

  updateMapSelection();
}

function selectMapRoute(routeId, options = {}) {
  state.selectedRouteId = routeId;
  updateMapSelection();

  const marker = state.markerById.get(routeId);
  if (marker) {
    if (options.panTo) {
      state.map.panTo(marker.getLatLng(), { animate: true });
    }
    if (options.openPopup) {
      marker.openPopup();
    }
  }

  if (options.scrollList) {
    const item = [...els.mapList.querySelectorAll(".map-item")]
      .find((element) => element.dataset.routeId === routeId);
    item?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
}

function updateMapSelection() {
  state.markerById.forEach((marker, routeId) => {
    const route = getAllMapRoutes().find((item) => item.id === routeId);
    if (!route) return;
    const selected = routeId === state.selectedRouteId;
    marker.setStyle(getMarkerStyle(route, selected));
    marker.setRadius(getMarkerStyle(route, selected).radius);
  });

  els.mapList.querySelectorAll(".map-item").forEach((item) => {
    item.classList.toggle("is-selected", item.dataset.routeId === state.selectedRouteId);
  });
}

function setSyncStatus(text) {
  els.syncStatus.textContent = text;
}

function formatDate(value) {
  if (!value) return "";
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return value;
  return `${day}. ${month}. ${year}`;
}

function formatGeneratedAt(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatNumber(value) {
  return new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 1 }).format(value);
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("'", "&#39;");
}

function bindEvents() {
  els.search.addEventListener("input", (event) => {
    state.query = event.target.value;
    renderActiveView();
  });

  els.segments.forEach((segment) => {
    segment.addEventListener("click", () => {
      state.filter = segment.dataset.filter;
      els.segments.forEach((item) => item.classList.toggle("is-active", item === segment));
      renderActiveView();
    });
  });

  els.viewTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      state.view = tab.dataset.view;
      els.viewTabs.forEach((item) => item.classList.toggle("is-active", item === tab));
      renderActiveView();
    });
  });

  els.refresh.addEventListener("click", () => loadExcelData());
  els.closeDialog.addEventListener("click", closeDialog);
  els.cancel.addEventListener("click", closeDialog);
  els.form.addEventListener("submit", (event) => event.preventDefault());
}

function init() {
  bindEvents();
  loadExcelData();
  setInterval(checkForExcelUpdate, 3000);
}

init();
