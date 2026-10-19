import { useId, useState } from "react";
import type { RefObject } from "react";
import { AccessibleDialog } from "../components/AccessibleDialog";
import { getPostTitle } from "../domain/postPresentation";
import type { PostsLoadState } from "../pages/Posts";
import type { Post } from "../types/social";

type GlobalPostSearchProps = {
  posts: readonly Post[];
  postsLoadState: PostsLoadState;
  onOpenPost: (id: string) => void;
  onClose: () => void;
  inputRef: RefObject<HTMLInputElement | null>;
};

export function GlobalPostSearch({ posts, postsLoadState, onOpenPost, onClose, inputRef }: GlobalPostSearchProps) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const id = useId();
  const normalized = query.trim().toLocaleLowerCase();
  const matches = postsLoadState === "success" && normalized
    ? posts.filter((post) => post.status !== "cancelled" &&
      `${post.title ?? ""}\n${post.caption}`.toLocaleLowerCase().includes(normalized)) : [];
  const visible = matches.slice(0, 20);
  const selectedIndex = visible.findIndex((post) => post.id === selectedId);
  const openPost = (postId: string) => { onClose(); onOpenPost(postId); };

  return <AccessibleDialog title="Pesquisar publicações" onClose={onClose} initialFocusRef={inputRef}>
    <label className="field-label">Título ou legenda
      <input ref={inputRef} role="combobox" aria-autocomplete="list" aria-expanded={visible.length > 0}
        aria-controls={`${id}-results`} aria-activedescendant={selectedIndex >= 0 ? `${id}-${selectedIndex}` : undefined}
        value={query} onChange={(event) => { setQuery(event.target.value); setSelectedId(null); }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            if (!visible.length) return;
            const next = selectedIndex < 0 ? (event.key === "ArrowDown" ? 0 : visible.length - 1)
              : (selectedIndex + (event.key === "ArrowDown" ? 1 : -1) + visible.length) % visible.length;
            setSelectedId(visible[next].id);
            document.getElementById(`${id}-${next}`)?.scrollIntoView?.({ block: "nearest" });
          } else if (event.key === "Enter") {
            event.preventDefault();
            const selected = visible[selectedIndex < 0 ? 0 : selectedIndex];
            if (selected) openPost(selected.id);
          }
        }} />
    </label>
    <p role={postsLoadState === "error" ? "alert" : "status"}>
      {postsLoadState === "loading" ? "Carregando publicações deste Workspace…"
        : postsLoadState === "error" ? "Não foi possível carregar as publicações deste Workspace."
          : !normalized ? "Digite para pesquisar nas publicações deste Workspace."
            : !matches.length ? "Nenhuma publicação encontrada."
              : matches.length > 20 ? `Exibindo 20 de ${matches.length} resultados. Refine a pesquisa para ver os demais.`
                : `${matches.length} resultado(s).`}
    </p>
    <ul className="global-search-results" id={`${id}-results`} role="listbox" aria-label="Publicações encontradas">
      {visible.map((post, index) => <li key={post.id} role="none">
        <button type="button" role="option" id={`${id}-${index}`} aria-selected={selectedIndex === index}
          onClick={() => openPost(post.id)}>
          <strong>{getPostTitle(post)}</strong><span>{post.caption}</span>
        </button>
      </li>)}
    </ul>
    <button type="button" className="secondary-button" onClick={onClose}>Fechar pesquisa</button>
  </AccessibleDialog>;
}
