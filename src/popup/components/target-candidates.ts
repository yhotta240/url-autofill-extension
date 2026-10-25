import {
  isTargetCandidatesResponse,
  TARGET_CANDIDATES_TYPE,
  type TargetCandidatesRequest,
} from "../../shared/target-candidates.ts";
import { type CurrentPage, normalizePageUrl } from "../current-page.ts";

/** 候補はフォーカス中だけ取得し，入力中の絞り込みは画面内で行う． */
export function createTargetCandidates(input: HTMLInputElement, panel: HTMLElement) {
  const list = panel.querySelector<HTMLElement>("[data-candidate-list]");
  const status = panel.querySelector<HTMLElement>("[data-candidate-status]");
  if (!list || !status) throw new Error("候補一覧のテンプレートが不正です．");
  list.id = `${input.id}-candidates`;
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-controls", list.id);
  input.setAttribute("aria-expanded", "false");

  let pageUrl = "";
  let page: CurrentPage | null | undefined;
  let contextKey = "";
  let revision = 0;
  let open = false;
  let candidates: string[] = [];
  let visible: string[] = [];
  let filter = "";
  let active = -1;
  let message = "";

  function position(): void {
    if (!open) return;
    const document = input.ownerDocument;
    const bottom =
      document.getElementById("panel")?.closest(".position-fixed")?.getBoundingClientRect().top ??
      document.defaultView?.innerHeight ??
      0;
    const available = Math.max(0, bottom - input.getBoundingClientRect().bottom - 4);
    panel.style.maxBlockSize = `min(10rem, ${available}px)`;
  }

  function render(): void {
    if (!list || !status) return;
    visible = candidates.filter((value) => value.toLowerCase().includes(filter.toLowerCase()));
    active = -1;
    input.removeAttribute("aria-activedescendant");
    list.replaceChildren(
      ...visible.map((value, index) => {
        const option = input.ownerDocument.createElement("li");
        option.id = `${list.id}-${index}`;
        option.setAttribute("role", "option");
        option.setAttribute("aria-selected", "false");
        option.dataset.index = String(index);
        option.textContent = value;
        return option;
      }),
    );
    list.hidden = visible.length === 0;
    status.textContent =
      message || (candidates.length ? "一致する候補がありません" : "候補がありません");
    status.hidden = visible.length > 0;
    position();
  }

  function close(): void {
    open = false;
    revision += 1;
    panel.hidden = true;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    input.ownerDocument.removeEventListener("scroll", position, true);
    input.ownerDocument.defaultView?.removeEventListener("resize", position);
  }

  async function load(): Promise<void> {
    const request = ++revision;
    candidates = [];
    const url = normalizePageUrl(pageUrl);
    message = "候補を取得しています…";
    if (page === null || !url) message = "このページでは候補を取得できません";
    else if (page && normalizePageUrl(page.url) !== url) {
      message = "現在のページとURLが異なるため候補を取得できません";
    }
    render();
    if (!page || !url || normalizePageUrl(page.url) !== url) return;
    try {
      const response: unknown = await chrome.tabs.sendMessage(
        page.tabId,
        { type: TARGET_CANDIDATES_TYPE } satisfies TargetCandidatesRequest,
        { frameId: 0 },
      );
      if (request !== revision) return;
      if (!isTargetCandidatesResponse(response)) throw new Error("invalid response");
      if (normalizePageUrl(response.url) !== url) {
        message = "現在のページとURLが異なるため候補を取得できません";
      } else {
        candidates = response.candidates;
        message = "";
      }
    } catch {
      if (request !== revision) return;
      message = "このページでは候補を取得できません";
    }
    render();
  }

  function focus(): void {
    open = true;
    panel.hidden = false;
    input.setAttribute("aria-expanded", "true");
    filter = "";
    input.ownerDocument.addEventListener("scroll", position, true);
    input.ownerDocument.defaultView?.addEventListener("resize", position);
    void load();
  }

  function select(index: number): void {
    const value = visible[index];
    if (value === undefined) return;
    close();
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function onInput(): void {
    if (!open) return;
    filter = input.value;
    render();
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.isComposing) return;
    if (event.key === "Escape") {
      if (open) event.preventDefault();
      close();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        focus();
        return;
      }
      if (!visible.length || !list) return;
      list.children[active]?.setAttribute("aria-selected", "false");
      if (event.key === "ArrowDown") active = (active + 1) % visible.length;
      else if (active <= 0) active = visible.length - 1;
      else active -= 1;
      const option = list.children[active];
      option.setAttribute("aria-selected", "true");
      input.setAttribute("aria-activedescendant", option.id);
      option.scrollIntoView?.({ block: "nearest" });
    } else if (event.key === "Enter" && open && active >= 0) {
      event.preventDefault();
      select(active);
    }
  }

  function onPointerDown(event: PointerEvent): void {
    if ((event.target as Element).closest("[data-index]")) event.preventDefault();
  }

  function onClick(event: MouseEvent): void {
    const option = (event.target as Element).closest<HTMLElement>("[data-index]");
    if (option && open) select(Number(option.dataset.index));
  }

  input.addEventListener("focus", focus);
  input.addEventListener("blur", close);
  input.addEventListener("input", onInput);
  input.addEventListener("keydown", onKeyDown);
  panel.addEventListener("pointerdown", onPointerDown);
  panel.addEventListener("click", onClick);

  return {
    update(nextUrl: string, nextPage: CurrentPage | null | undefined): void {
      const key = JSON.stringify([nextUrl, nextPage === undefined ? "loading" : nextPage]);
      if (key === contextKey) return;
      contextKey = key;
      pageUrl = nextUrl;
      page = nextPage;
      if (open) void load();
    },
    dispose(): void {
      close();
      input.removeEventListener("focus", focus);
      input.removeEventListener("blur", close);
      input.removeEventListener("input", onInput);
      input.removeEventListener("keydown", onKeyDown);
      panel.removeEventListener("pointerdown", onPointerDown);
      panel.removeEventListener("click", onClick);
    },
  };
}
