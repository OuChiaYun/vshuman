document.addEventListener("DOMContentLoaded", () => {
  // ------- 上面槽位列 -------

  const cardTrack = document.getElementById("cardTrack");
  const prevBtn = document.getElementById("cardPrev");
  const nextBtn = document.getElementById("cardNext");
  const productGrid = document.getElementById("productGrid");

  // 保險：避免 null.addEventListener
  if (!cardTrack || !prevBtn || !nextBtn || !productGrid) {
    console.warn("[other.js] Missing DOM:", { cardTrack, prevBtn, nextBtn, productGrid });
    return;
  }

  const TOTAL_SLOTS = 10;
  const slots = [];
  const slotData = new Array(TOTAL_SLOTS).fill(null); // 每個槽位存放的商品（可空）
  let currentSlot = 0; // 目前選中的槽位

  const SLOT_BASE_CLASS =
    "card-item flex-shrink-0 w-32 h-20 rounded-2xl enabled:hover:cursor-pointer " +
    "flex flex-col items-center justify-center text-[11px] leading-tight";

  // ======= 給 app.js 用：產生 payload + 發送狀態 =======
  function buildSlotsPayload() {
    return {
      list: slotData.map((x) => x ?? {}), // 空槽位 -> {}
      active: currentSlot,                // 目前選中的 slot index
    };
  }

  function emitSlotsState(reason = "") {
    const payload = buildSlotsPayload();

    // 1) 快取一份在 window（app.js 晚載入也讀得到）
    window.__SLOTS_STATE__ = payload;

    // 2) 即時事件通知
    window.dispatchEvent(
      new CustomEvent("slots:state", { detail: { ...payload, reason } })
    );
  }

  function renderSlots() {
    slots.forEach((slot, i) => {
      const data = slotData[i];
      const isSelected = i === currentSlot;

      slot.className =
        SLOT_BASE_CLASS +
        " " +
        (isSelected
          ? "bg-slate-300 border-[3px] border-black enabled:hover:cursor-pointer "
          : "bg-slate-200 border border-transparent");

      if (data && data.name != null) {
        slot.innerHTML = `
          <div class="font-semibold truncate max-w-[7rem]">${data.name}</div>
          <div class="text-[10px] text-slate-700">$${data.price ?? ""}</div>
        `;
      } else {
        slot.innerHTML = `<div class="text-slate-500">Slot ${i + 1}</div>`;
      }
    });
  }

  // 建立 10 個槽位按鈕
  for (let i = 0; i < TOTAL_SLOTS; i++) {
    const btn = document.createElement("button");
    btn.dataset.slotIndex = i;

    btn.addEventListener("click", () => {
      currentSlot = i;
      renderSlots();
      emitSlotsState("slot-click"); // ✅ 告訴 app.js：active 變了
    });

    slots.push(btn);
    cardTrack.appendChild(btn);
  }

  // 左右箭頭：只控制捲動
  function scrollTrack(dir) {
    const amount = cardTrack.clientWidth * 0.8;
    cardTrack.scrollBy({ left: dir * amount, behavior: "smooth" });
  }

  prevBtn.addEventListener("click", () => scrollTrack(-1));
  nextBtn.addEventListener("click", () => scrollTrack(1));

  // 初始化槽位顯示
  renderSlots();

  // ------- 下面商品網格 -------

  async function loadProductsFromImgInfo() {
    try {
      const res = await fetch("./info/imginfo.json", { cache: "no-store" });
      if (!res.ok) throw new Error(`fetch failed: ${res.status}`);

      const products = await res.json(); // array
      productGrid.innerHTML = "";

      products.forEach((p, idx) => {
        const priceText =
          typeof p.price === "number" ? p.price.toLocaleString() : String(p.price ?? "");

        productGrid.appendChild(
          createProductCard({
            id: p.id ?? idx,
            name: p.name ?? `Item ${idx + 1}`,
            price: priceText,
            text: p.text ?? "",
            text_url: p.text_url ?? "",
            image_url: p.image_url ?? "",
          })
        );
      });
    } catch (err) {
      console.error("Failed to load imginfo:", err);
    }
  }

  function createProductCard(product) {
    const card = document.createElement("button");
    card.className =
      "w-40 h-44 bg-slate-200 rounded-2xl overflow-hidden enabled:hover:cursor-pointer " +
      "flex flex-col shadow-sm hover:shadow-md transition";

    const imgPart = product.image_url
      ? `<img src="${product.image_url}" alt="${product.name}" class="w-full h-full object-contain bg-white" />`
      : `<div class="flex-1 bg-white"></div>`;

    card.innerHTML = `
      <div class="flex-1">${imgPart}</div>
      <div class="px-2 py-1 text-[11px] text-center">
        <div class="truncate">${product.name}</div>
        <div class="font-semibold">$${product.price}</div>
      </div>
    `;

    card.addEventListener("click", () => {
      if (currentSlot == null) currentSlot = 0;

      // 填入目前選中的槽位
      slotData[currentSlot] = {
        name: product.name,
        price: product.price,
        text_url: product.text_url,
        image_url: product.image_url,
        text: product.text,
      };

      renderSlots();
      emitSlotsState("product-click"); // ✅ 告訴 app.js：list/active 更新了
    });

    return card;
  }

  // 初始化載入
  loadProductsFromImgInfo();

  // ✅ 初始狀態先送一次（app.js 一開始就能拿到）
  emitSlotsState("init");
});
