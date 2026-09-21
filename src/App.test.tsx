import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { ApiClient } from "./data/api/apiClient";
import { initialPosts } from "./data/mockData";
import { HttpPostsRepository } from "./data/posts/HttpPostsRepository";
import type { PostsRepository } from "./data/posts/PostsRepository";
import { getPostTitle } from "./domain/postPresentation";
import type { Post } from "./types/social";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, reject, resolve };
}

function uuid(value: number): string {
  return `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
}

const createdPost: Post = {
  ...initialPosts[0],
  id: uuid(99),
  title: "Publicação com latência",
  caption: "Publicação criada após a resposta controlada.",
  scheduledFor: "2098-01-14T11:00:00-03:00",
};

describe("SocialFlow", () => {
  beforeEach(() => {
    window.location.hash = "#/";
  });

  it("renderiza a aplicação", () => {
    render(<App />);

    expect(
      screen.getByRole("heading", { level: 1, name: /Olá, Davi!/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("navigation", { name: "Navegação principal" }),
    ).toBeInTheDocument();
  });

  it("mantém o repositório mock isolado mesmo com configuração HTTP", async () => {
    vi.stubEnv("VITE_POSTS_REPOSITORY", "http");
    vi.stubEnv(
      "VITE_API_URL",
      "https://api-nao-deve-ser-acessada.invalid",
    );
    vi.clearAllMocks();

    render(<App />);

    expect(await screen.findByText(initialPosts[0].title)).toBeInTheDocument();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("exibe estados de carregamento e vazio sem publicação fictícia", async () => {
    const pendingList = deferred<Post[]>();
    const repository: PostsRepository = {
      create: vi.fn(),
      list: vi.fn(() => pendingList.promise),
    };

    render(<App repository={repository} />);

    expect(screen.getByText("Carregando publicações")).toBeInTheDocument();
    expect(screen.queryByText("PRÓXIMA PUBLICAÇÃO")).not.toBeInTheDocument();
    expect(screen.queryByText("Hoje, 14:30")).not.toBeInTheDocument();
    expect(screen.queryByText("2 de 3")).not.toBeInTheDocument();

    await act(async () => {
      pendingList.resolve([]);
      await pendingList.promise;
    });

    expect(
      await screen.findByText("Nenhuma publicação agendada"),
    ).toBeInTheDocument();
    expect(screen.queryByText("PRÓXIMA PUBLICAÇÃO")).not.toBeInTheDocument();
    expect(screen.queryByText("Hoje, 14:30")).not.toBeInTheDocument();
    expect(screen.queryByText("2 de 3")).not.toBeInTheDocument();
  });

  it("mantém o cartão de próxima publicação quando existe um post", async () => {
    const repository: PostsRepository = {
      create: vi.fn(),
      list: vi.fn().mockResolvedValue(initialPosts),
    };

    render(<App repository={repository} />);

    expect(await screen.findByText("PRÓXIMA PUBLICAÇÃO")).toBeInTheDocument();
    expect(screen.getByText("12 ago, 14:30")).toBeInTheDocument();
    expect(screen.getByText("2 de 3")).toBeInTheDocument();
    expect(screen.getByText(initialPosts[0].title)).toBeInTheDocument();
    expect(screen.getByText(initialPosts[0].caption)).toBeInTheDocument();
  });

  it("exibe os metadados da publicação realmente agendada", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 12, 12));
    const pendingList = deferred<Post[]>();
    const scheduledPost: Post = {
      ...initialPosts[1],
      caption: "Conteúdo exclusivo para TikTok e LinkedIn.",
      scheduledFor: "2026-08-18T07:45:00-03:00",
      title: "Próxima publicação da API",
    };
    const laterScheduledPost: Post = {
      ...scheduledPost,
      id: uuid(501),
      scheduledFor: "2026-08-20T07:45:00-03:00",
      title: "Publicação posterior recebida primeiro",
    };
    const repository: PostsRepository = {
      create: vi.fn(),
      list: vi.fn(() => pendingList.promise),
    };

    try {
      render(<App repository={repository} />);

      await act(async () => {
        pendingList.resolve([
          laterScheduledPost,
          initialPosts[2],
          initialPosts[3],
          scheduledPost,
        ]);
        await pendingList.promise;
      });

      const card = screen.getByText("PRÓXIMA PUBLICAÇÃO").closest("article");
      expect(card).not.toBeNull();

      const cardQueries = within(card!);
      expect(cardQueries.getByRole("heading", { level: 3 })).toHaveTextContent(
        "18 ago, 07:45",
      );
      expect(cardQueries.getByText(getPostTitle(scheduledPost))).toBeInTheDocument();
      expect(cardQueries.getByText(scheduledPost.caption)).toBeInTheDocument();
      expect(cardQueries.queryByLabelText("Instagram")).not.toBeInTheDocument();
      expect(cardQueries.queryByLabelText("Facebook")).not.toBeInTheDocument();
      expect(cardQueries.queryByLabelText("TikTok")).not.toBeInTheDocument();
      expect(cardQueries.queryByLabelText("LinkedIn")).not.toBeInTheDocument();
      expect(screen.queryByText(initialPosts[2].title)).not.toBeInTheDocument();
      expect(screen.queryByText(initialPosts[3].title)).not.toBeInTheDocument();
      expect(
        screen.queryByText(getPostTitle(laterScheduledPost)),
      ).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("exibe Hoje somente quando a data da publicação é a data atual", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 12, 8));
    const pendingList = deferred<Post[]>();
    const todayPost: Post = {
      ...initialPosts[0],
      scheduledFor: "2026-08-12T08:20:00-03:00",
    };
    const repository: PostsRepository = {
      create: vi.fn(),
      list: vi.fn(() => pendingList.promise),
    };
    const view = render(<App repository={repository} />);

    try {
      await act(async () => {
        pendingList.resolve([todayPost]);
        await pendingList.promise;
      });

      expect(
        screen.getByRole("heading", { level: 3, name: "Hoje, 08:20" }),
      ).toBeInTheDocument();
      expect(vi.getTimerCount()).toBe(1);
    } finally {
      view.unmount();
      expect(vi.getTimerCount()).toBe(0);
      vi.useRealTimers();
    }
  });

  it("reavalia a próxima publicação quando o horário passa", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 12, 9));
    const pendingList = deferred<Post[]>();
    const firstPost: Post = {
      ...initialPosts[0],
      id: uuid(601),
      scheduledFor: new Date(2026, 7, 12, 9, 1).toISOString(),
      title: "Publicação das 09:01",
    };
    const secondPost: Post = {
      ...initialPosts[1],
      id: uuid(602),
      scheduledFor: new Date(2026, 7, 12, 9, 2).toISOString(),
      title: "Publicação das 09:02",
    };
    const list = vi.fn(() => pendingList.promise);
    const repository: PostsRepository = { create: vi.fn(), list };
    const view = render(<App repository={repository} />);

    try {
      await act(async () => {
        pendingList.resolve([secondPost, firstPost]);
        await pendingList.promise;
      });

      expect(screen.getByText(getPostTitle(firstPost))).toBeInTheDocument();
      expect(screen.queryByText(getPostTitle(secondPost))).not.toBeInTheDocument();

      act(() => vi.advanceTimersByTime(60_000));

      expect(screen.queryByText(getPostTitle(firstPost))).not.toBeInTheDocument();
      expect(screen.getByText(getPostTitle(secondPost))).toBeInTheDocument();

      act(() => vi.advanceTimersByTime(60_000));

      expect(screen.queryByText(getPostTitle(secondPost))).not.toBeInTheDocument();
      expect(
        screen.getByText("Nenhuma publicação agendada"),
      ).toBeInTheDocument();
      expect(list).toHaveBeenCalledTimes(1);
    } finally {
      view.unmount();
      vi.useRealTimers();
    }
  });

  it("mantém o post mais próximo ao reconciliar novas criações", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 12, 9));
    const pendingList = deferred<Post[]>();
    const laterCreate = deferred<Post>();
    const earlierCreate = deferred<Post>();
    const listedPost: Post = {
      ...initialPosts[0],
      id: uuid(611),
      scheduledFor: new Date(2026, 7, 14, 10).toISOString(),
      title: "Publicação mais próxima da lista",
    };
    const laterPost: Post = {
      ...initialPosts[0],
      id: uuid(612),
      scheduledFor: new Date(2026, 7, 20, 10).toISOString(),
      title: "Criação posterior",
    };
    const earlierPost: Post = {
      ...initialPosts[0],
      id: uuid(613),
      scheduledFor: new Date(2026, 7, 13, 10).toISOString(),
      title: "Criação anterior",
    };
    const create = vi
      .fn<PostsRepository["create"]>()
      .mockImplementationOnce(() => laterCreate.promise)
      .mockImplementationOnce(() => earlierCreate.promise);
    const list = vi.fn(() => pendingList.promise);
    const repository: PostsRepository = { create, list };
    const view = render(<App repository={repository} />);

    try {
      await act(async () => {
        pendingList.resolve([listedPost]);
        await pendingList.promise;
      });

      expect(screen.getByText(getPostTitle(listedPost))).toBeInTheDocument();

      fireEvent.click(
        screen.getByRole("button", { name: /Criar publicação/i }),
      );
      fireEvent.change(screen.getByRole("textbox", { name: /^Legenda/ }), {
        target: { value: "Agendamento posterior." },
      });
      fireEvent.change(screen.getByLabelText("Data"), {
        target: { value: "2026-08-20" },
      });
      fireEvent.submit(
        screen.getByRole("button", { name: "Agendar publicação" }).closest(
          "form",
        )!,
      );

      await act(async () => {
        laterCreate.resolve(laterPost);
        await laterCreate.promise;
      });

      expect(screen.getByText(getPostTitle(listedPost))).toBeInTheDocument();
      expect(screen.queryByText(getPostTitle(laterPost))).not.toBeInTheDocument();

      fireEvent.click(
        screen.getByRole("button", { name: /Criar publicação/i }),
      );
      fireEvent.change(screen.getByRole("textbox", { name: /^Legenda/ }), {
        target: { value: "Agendamento anterior." },
      });
      fireEvent.change(screen.getByLabelText("Data"), {
        target: { value: "2026-08-13" },
      });
      fireEvent.submit(
        screen.getByRole("button", { name: "Agendar publicação" }).closest(
          "form",
        )!,
      );

      await act(async () => {
        earlierCreate.resolve(earlierPost);
        await earlierCreate.promise;
      });

      expect(screen.getByText(getPostTitle(earlierPost))).toBeInTheDocument();
      expect(screen.queryByText(getPostTitle(listedPost))).not.toBeInTheDocument();
      expect(create).toHaveBeenCalledTimes(2);
      expect(list).toHaveBeenCalledTimes(1);
    } finally {
      view.unmount();
      vi.useRealTimers();
    }
  });

  it("mostra falha no Overview sem reutilizar posts de outro repositório", async () => {
    const pendingNextList = deferred<Post[]>();
    const firstRepository: PostsRepository = {
      create: vi.fn(),
      list: vi.fn().mockResolvedValue(initialPosts),
    };
    const nextRepository: PostsRepository = {
      create: vi.fn(),
      list: vi.fn(() => pendingNextList.promise),
    };
    const { rerender } = render(<App repository={firstRepository} />);

    expect(await screen.findByText(initialPosts[0].title)).toBeInTheDocument();

    rerender(<App repository={nextRepository} />);

    expect(
      screen.getByRole("heading", {
        level: 3,
        name: "Carregando publicações",
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText(initialPosts[0].title)).not.toBeInTheDocument();

    await act(async () => {
      pendingNextList.reject(new Error("Falha temporária"));
      await pendingNextList.promise.catch(() => undefined);
      await Promise.resolve();
    });

    expect(
      screen.getByRole("heading", {
        level: 3,
        name: "Não foi possível carregar as publicações",
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Nenhuma publicação agendada"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(initialPosts[0].title)).not.toBeInTheDocument();
  });

  it("trata uma resposta 200 sem corpo como erro de carregamento", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 200 }));
    const repository = new HttpPostsRepository(
      new ApiClient({
        baseUrl: "https://api.socialflow.example",
        fetchImpl: fetchMock,
      }),
    );

    render(<App repository={repository} />);

    expect(
      await screen.findByRole("heading", {
        level: 3,
        name: "Não foi possível carregar as publicações",
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Nenhuma publicação agendada"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("PRÓXIMA PUBLICAÇÃO")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("compartilha uma listagem HTTP pendente no StrictMode", async () => {
    const pendingFetch = deferred<Response>();
    const fetchMock = vi.fn<typeof fetch>(() => pendingFetch.promise);
    const repository = new HttpPostsRepository(
      new ApiClient({
        baseUrl: "https://api.socialflow.example",
        fetchImpl: fetchMock,
      }),
    );
    const listedPost: Post = {
      ...initialPosts[0],
      title: "Publicação carregada uma única vez",
    };

    render(
      <StrictMode>
        <App repository={repository} />
      </StrictMode>,
    );

    expect(screen.getByText("Carregando publicações")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://api.socialflow.example/posts",
    );
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({ method: "GET" }),
    );

    await act(async () => {
      pendingFetch.resolve(
        new Response(JSON.stringify([listedPost]), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        }),
      );
      await pendingFetch.promise;
    });

    expect(await screen.findByText(getPostTitle(listedPost))).toBeInTheDocument();
    expect(screen.getByText("12 ago, 14:30")).toBeInTheDocument();
    expect(screen.queryByText("Carregando publicações")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("libera uma listagem HTTP rejeitada para uma tentativa posterior", async () => {
    const firstFetch = deferred<Response>();
    const secondFetch = deferred<Response>();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(() => firstFetch.promise)
      .mockImplementationOnce(() => secondFetch.promise);
    const repository = new HttpPostsRepository(
      new ApiClient({
        baseUrl: "https://api.socialflow.example",
        fetchImpl: fetchMock,
      }),
    );
    const listedPost: Post = {
      ...initialPosts[0],
      title: "Publicação carregada após nova tentativa",
    };
    const firstRender = render(
      <StrictMode>
        <App repository={repository} />
      </StrictMode>,
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      firstFetch.reject(new Error("Falha temporária"));
      await firstFetch.promise.catch(() => undefined);
    });

    expect(
      await screen.findByRole("heading", {
        level: 3,
        name: "Não foi possível carregar as publicações",
      }),
    ).toBeInTheDocument();

    firstRender.unmount();

    render(
      <StrictMode>
        <App repository={repository} />
      </StrictMode>,
    );

    expect(screen.getByText("Carregando publicações")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      secondFetch.resolve(
        new Response(JSON.stringify([listedPost]), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        }),
      );
      await secondFetch.promise;
    });

    expect(await screen.findByText(getPostTitle(listedPost))).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("remove o toast de falha após o prazo de exibição", async () => {
    vi.useFakeTimers();
    const pendingList = deferred<Post[]>();
    const repository: PostsRepository = {
      create: vi.fn(),
      list: vi.fn(() => pendingList.promise),
    };

    try {
      render(<App repository={repository} />);

      await act(async () => {
        pendingList.reject(new Error("Falha temporária"));
        await pendingList.promise.catch(() => undefined);
        await Promise.resolve();
      });

      const errorToast = screen.getByRole("alert");
      expect(errorToast).toHaveTextContent(
        "Não foi possível carregar as publicações.",
      );
      expect(errorToast).toHaveClass("toast--error");
      expect(errorToast.querySelector("span")).toHaveTextContent("!");

      act(() => vi.advanceTimersByTime(3500));

      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("reinicia o prazo quando a mesma falha é emitida novamente", async () => {
    vi.useFakeTimers();
    const pendingList = deferred<Post[]>();
    const firstCreate = deferred<Post>();
    const secondCreate = deferred<Post>();
    const create = vi
      .fn<PostsRepository["create"]>()
      .mockImplementationOnce(() => firstCreate.promise)
      .mockImplementationOnce(() => secondCreate.promise);
    const repository: PostsRepository = {
      create,
      list: vi.fn(() => pendingList.promise),
    };

    try {
      render(<App repository={repository} />);

      await act(async () => {
        pendingList.resolve(initialPosts);
        await pendingList.promise;
      });

      fireEvent.click(
        screen.getByRole("button", { name: /Criar publicação/i }),
      );
      const captionInput = screen.getByRole("textbox", { name: /^Legenda/ });
      fireEvent.change(captionInput, {
        target: { value: "Publicação que falhará duas vezes." },
      });

      const submitButton = screen.getByRole("button", {
        name: "Agendar publicação",
      });
      const form = submitButton.closest("form");
      expect(form).not.toBeNull();

      fireEvent.submit(form!);
      fireEvent.change(captionInput, {
        target: { value: "Rascunho revisado enquanto o envio falhava." },
      });
      await act(async () => {
        firstCreate.reject(new Error("Falha temporária"));
        await firstCreate.promise.catch(() => undefined);
      });

      expect(captionInput).toHaveValue(
        "Rascunho revisado enquanto o envio falhava.",
      );

      const firstErrorToast = screen.getByRole("alert");
      expect(firstErrorToast).toHaveTextContent(
        "Não foi possível agendar a publicação.",
      );
      expect(firstErrorToast).toHaveClass("toast--error");
      expect(firstErrorToast.querySelector("span")).toHaveTextContent("!");

      act(() => vi.advanceTimersByTime(3000));

      fireEvent.submit(form!);
      await act(async () => {
        secondCreate.reject(new Error("Falha temporária"));
        await secondCreate.promise.catch(() => undefined);
      });

      expect(create).toHaveBeenCalledTimes(2);

      act(() => vi.advanceTimersByTime(500));
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Não foi possível agendar a publicação.",
      );

      act(() => vi.advanceTimersByTime(2999));
      expect(screen.getByRole("alert")).toBeInTheDocument();

      act(() => vi.advanceTimersByTime(1));
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("navega para Publicações", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: /Publicações/ }));

    expect(
      await screen.findByRole("heading", { level: 1, name: "Publicações" }),
    ).toBeInTheDocument();
    expect(window.location.hash).toBe("#/publicacoes");
    expect(await screen.findByText("Bastidores da torra")).toBeInTheDocument();
  });

  it("não mostra contadores de Publicações durante o carregamento", () => {
    window.location.hash = "#/publicacoes";
    const pendingList = deferred<Post[]>();
    const repository: PostsRepository = {
      create: vi.fn(),
      list: vi.fn(() => pendingList.promise),
    };

    render(<App repository={repository} />);

    expect(screen.getByRole("status")).toHaveTextContent(
      "Carregando publicações",
    );
    expect(
      screen.queryByRole("button", { name: /^Todos/ }),
    ).not.toBeInTheDocument();
  });

  it("mostra falha sem contadores quando a listagem é rejeitada", async () => {
    window.location.hash = "#/publicacoes";
    const pendingList = deferred<Post[]>();
    const repository: PostsRepository = {
      create: vi.fn(),
      list: vi.fn(() => pendingList.promise),
    };

    render(<App repository={repository} />);

    await act(async () => {
      pendingList.reject(new Error("Falha temporária"));
      await pendingList.promise.catch(() => undefined);
      await Promise.resolve();
    });

    const incompleteDataWarning = screen.getByText(
      /Os dados exibidos podem estar incompletos/,
      { selector: "p" },
    );
    expect(incompleteDataWarning).toHaveAttribute("role", "alert");
    expect(
      screen.queryByRole("button", { name: /^Todos/ }),
    ).not.toBeInTheDocument();
  });

  it("exibe um post criado após falha sem ocultar o aviso de dados incompletos", async () => {
    window.location.hash = "#/publicacoes";
    const user = userEvent.setup();
    const pendingList = deferred<Post[]>();
    const pendingCreate = deferred<Post>();
    const create = vi.fn(() => pendingCreate.promise);
    const repository: PostsRepository = {
      create,
      list: vi.fn(() => pendingList.promise),
    };

    render(<App repository={repository} />);

    await act(async () => {
      pendingList.reject(new Error("Falha temporária"));
      await pendingList.promise.catch(() => undefined);
      await Promise.resolve();
    });

    await user.click(
      screen.getAllByRole("button", { name: /Criar publicação/i })[0],
    );
    await user.type(
      screen.getByRole("textbox", { name: /^Legenda/ }),
      "Post confirmado mesmo com a lista incompleta.",
    );
    await user.click(
      screen.getByRole("button", { name: "Agendar publicação" }),
    );

    await act(async () => {
      pendingCreate.resolve(createdPost);
      await pendingCreate.promise;
    });

    expect(create).toHaveBeenCalledTimes(1);
    expect(
      screen.getByText(/Os dados exibidos podem estar incompletos/, {
        selector: "p",
      }),
    ).toHaveAttribute("role", "alert");
    expect(screen.getByText(getPostTitle(createdPost))).toBeInTheDocument();
    expect(screen.getAllByText(getPostTitle(createdPost))).toHaveLength(1);
    expect(
      screen.queryByRole("button", { name: /^Todos/ }),
    ).not.toBeInTheDocument();
  });

  it("mostra contadores zerados somente após uma lista vazia confirmada", async () => {
    window.location.hash = "#/publicacoes";
    const repository: PostsRepository = {
      create: vi.fn(),
      list: vi.fn().mockResolvedValue([]),
    };

    render(<App repository={repository} />);

    expect(
      await screen.findByRole("button", { name: /Todos\s*0/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("preserva contadores e publicações após uma listagem com posts", async () => {
    window.location.hash = "#/publicacoes";
    const repository: PostsRepository = {
      create: vi.fn(),
      list: vi.fn().mockResolvedValue(initialPosts),
    };

    render(<App repository={repository} />);

    expect(
      await screen.findByRole("button", { name: /Todos\s*4/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Agendado\s*2/ }),
    ).toBeInTheDocument();
    expect(screen.getByText(initialPosts[0].title)).toBeInTheDocument();
  });

  it("abre o formulário Criar publicação", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(
      screen.getByRole("button", { name: /Criar publicação/i }),
    );

    expect(
      screen.getByRole("heading", { level: 2, name: "Criar publicação" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: /^Legenda/ }),
    ).toBeInTheDocument();
  });

  it("cria uma publicação simulada", async () => {
    const user = userEvent.setup();
    const caption =
      "Café especial para a comunidade! Uma nova experiência no SocialFlow.";

    render(<App />);

    await user.click(
      screen.getByRole("button", { name: /Criar publicação/i }),
    );
    await user.type(screen.getByRole("textbox", { name: /^Legenda/ }), caption);
    await user.click(
      screen.getByRole("button", { name: /Agendar publicação/i }),
    );

    const successToast = await screen.findByRole("status");
    expect(successToast).toHaveTextContent(
      "Publicação agendada com sucesso!",
    );
    expect(successToast).toHaveClass("toast--success");
    expect(successToast.querySelector("span")).toHaveTextContent("✓");

    await user.click(screen.getByRole("button", { name: /Publicações/ }));

    expect(
      screen.getByText("Café especial para a comunidade"),
    ).toBeInTheDocument();
    expect(screen.getByText(caption)).toBeInTheDocument();
  });

  it("preserva ano e horário local do Composer no repositório HTTP", async () => {
    const sentPosts: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      if (init?.method === "GET") {
        return new Response("[]", {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }

      const post = JSON.parse(String(init?.body)) as Record<string, unknown>;
      sentPosts.push(post);
      const timestamp = new Date().toISOString();
      return new Response(
        JSON.stringify({
          ...post,
          authorUserId: "22222222-2222-4222-8222-222222222222",
          createdAt: timestamp,
          id: uuid(700 + sentPosts.length),
          publishedAt: null,
          ragRunId: null,
          tenantId: "11111111-1111-4111-8111-111111111111",
          updatedAt: timestamp,
        }),
        {
          headers: { "Content-Type": "application/json" },
          status: 201,
        },
      );
    });
    const repository = new HttpPostsRepository(
      new ApiClient({
        baseUrl: "https://api.socialflow.example",
        fetchImpl: fetchMock,
      }),
    );
    const user = userEvent.setup();

    render(<App repository={repository} />);

    expect(
      await screen.findByText("Nenhuma publicação agendada"),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: /Criar publicação/i }),
    );
    await user.type(
      screen.getByRole("textbox", { name: /^Legenda/ }),
      "Agendamento de 2026.",
    );
    fireEvent.change(screen.getByLabelText("Data"), {
      target: { value: "2026-08-13" },
    });
    fireEvent.change(screen.getByLabelText("Horário"), {
      target: { value: "10:00" },
    });
    await user.click(
      screen.getByRole("button", { name: "Agendar publicação" }),
    );

    await waitFor(() =>
      expect(
        screen.queryByRole("heading", { name: "Criar publicação" }),
      ).not.toBeInTheDocument(),
    );

    await user.click(
      screen.getByRole("button", { name: /Criar publicação/i }),
    );
    await user.type(
      screen.getByRole("textbox", { name: /^Legenda/ }),
      "Agendamento de 2027.",
    );
    fireEvent.change(screen.getByLabelText("Data"), {
      target: { value: "2027-08-13" },
    });
    fireEvent.change(screen.getByLabelText("Horário"), {
      target: { value: "10:00" },
    });
    await user.click(
      screen.getByRole("button", { name: "Agendar publicação" }),
    );

    await waitFor(() => expect(sentPosts).toHaveLength(2));

    const expected2026 = new Date(2026, 7, 13, 10).toISOString();
    const expected2027 = new Date(2027, 7, 13, 10).toISOString();
    expect(expected2026).toBe("2026-08-13T13:00:00.000Z");
    expect(expected2027).toBe("2027-08-13T13:00:00.000Z");
    expect(sentPosts[0]).toEqual(
      expect.objectContaining({ scheduledFor: expected2026 }),
    );
    expect(sentPosts[1]).toEqual(
      expect.objectContaining({ scheduledFor: expected2027 }),
    );
    expect(sentPosts[0]?.scheduledFor).not.toBe(sentPosts[1]?.scheduledFor);
    expect(sentPosts[0]).not.toHaveProperty("date");
    expect(sentPosts[0]).not.toHaveProperty("time");
    expect(fetchMock).toHaveBeenCalledTimes(3);

    await user.click(screen.getByRole("button", { name: /Publicações/ }));

    for (const title of ["Agendamento de 2026", "Agendamento de 2027"]) {
      const row = screen.getByText(title).closest("article");
      expect(row).not.toBeNull();
      expect(within(row!).getByText(/13 ago,\s+10:00/)).toBeInTheDocument();
    }
  });

  it("impede a criação enquanto o carregamento inicial está pendente", async () => {
    const user = userEvent.setup();
    const pendingList = deferred<Post[]>();
    const create = vi.fn<PostsRepository["create"]>();
    const repository: PostsRepository = {
      create,
      list: vi.fn(() => pendingList.promise),
    };

    render(<App repository={repository} />);

    await user.click(
      screen.getByRole("button", { name: /Criar publicação/i }),
    );
    await user.type(
      screen.getByRole("textbox", { name: /^Legenda/ }),
      "Tentativa durante o carregamento.",
    );

    const submitButton = screen.getByRole("button", {
      name: "Agendar publicação",
    });
    const form = submitButton.closest("form");

    expect(submitButton).toBeDisabled();
    expect(form).not.toBeNull();

    fireEvent.submit(form!);

    expect(create).not.toHaveBeenCalled();

    await act(async () => {
      pendingList.resolve(initialPosts);
      await pendingList.promise;
    });

    await waitFor(() => expect(submitButton).toBeEnabled());
  });

  it("preserva um post criado após o início de uma listagem antiga", async () => {
    const user = userEvent.setup();
    const pendingCreate = deferred<Post>();
    const pendingStaleList = deferred<Post[]>();
    const firstRepository: PostsRepository = {
      create: vi.fn(() => pendingCreate.promise),
      list: vi.fn().mockResolvedValue(initialPosts),
    };
    const nextRepository: PostsRepository = {
      create: vi.fn(),
      list: vi.fn(() => pendingStaleList.promise),
    };
    const { rerender } = render(<App repository={firstRepository} />);

    await user.click(
      screen.getByRole("button", { name: /Criar publicação/i }),
    );
    await user.type(
      screen.getByRole("textbox", { name: /^Legenda/ }),
      "Publicação preservada contra lista antiga.",
    );

    const submitButton = screen.getByRole("button", {
      name: "Agendar publicação",
    });

    await waitFor(() => expect(submitButton).toBeEnabled());
    await user.click(submitButton);

    rerender(<App repository={nextRepository} />);

    await act(async () => {
      pendingCreate.resolve(createdPost);
      await pendingCreate.promise;
    });
    await act(async () => {
      pendingStaleList.resolve(initialPosts);
      await pendingStaleList.promise;
    });

    await user.click(screen.getByRole("button", { name: /Publicações/ }));

    expect(screen.getByText(getPostTitle(createdPost))).toBeInTheDocument();
  });

  it("reconcilia criação e nova listagem por id sem perder dados", async () => {
    const user = userEvent.setup();
    const pendingCreate = deferred<Post>();
    const pendingNextList = deferred<Post[]>();
    const oldOnlyPost: Post = {
      ...initialPosts[0],
      id: uuid(201),
      title: "Post apenas do repositório anterior",
    };
    const listedOnlyPost: Post = {
      ...initialPosts[1],
      id: uuid(202),
      title: "Post exclusivo da nova listagem",
    };
    const staleCreatedPost: Post = {
      ...createdPost,
      title: "Versão da listagem com o mesmo identificador",
    };
    const firstRepository: PostsRepository = {
      create: vi.fn(() => pendingCreate.promise),
      list: vi.fn().mockResolvedValue([oldOnlyPost]),
    };
    const nextList = vi.fn(() => pendingNextList.promise);
    const nextRepository: PostsRepository = {
      create: vi.fn(),
      list: nextList,
    };
    const { rerender } = render(<App repository={firstRepository} />);

    await user.click(
      screen.getByRole("button", { name: /Criar publicação/i }),
    );
    await user.type(
      screen.getByRole("textbox", { name: /^Legenda/ }),
      "Criação concorrente com uma nova listagem.",
    );

    const submitButton = screen.getByRole("button", {
      name: "Agendar publicação",
    });
    await waitFor(() => expect(submitButton).toBeEnabled());
    await user.click(submitButton);

    expect(firstRepository.create).toHaveBeenCalledTimes(1);

    rerender(<App repository={nextRepository} />);
    expect(nextList).toHaveBeenCalledTimes(1);

    await act(async () => {
      pendingCreate.resolve(createdPost);
      await pendingCreate.promise;
    });
    await act(async () => {
      pendingNextList.resolve([listedOnlyPost, staleCreatedPost]);
      await pendingNextList.promise;
    });

    await user.click(screen.getByRole("button", { name: /Publicações/ }));

    expect(screen.getByText(getPostTitle(createdPost))).toBeInTheDocument();
    expect(screen.getAllByText(getPostTitle(createdPost))).toHaveLength(1);
    expect(screen.getByText(getPostTitle(listedOnlyPost))).toBeInTheDocument();
    expect(screen.queryByText(getPostTitle(staleCreatedPost))).not.toBeInTheDocument();
    expect(screen.queryByText(getPostTitle(oldOnlyPost))).not.toBeInTheDocument();
  });

  it("cria nova geração ao voltar ao mesmo repositório e ignora a intermediária", async () => {
    const user = userEvent.setup();
    const firstAList = deferred<Post[]>();
    const secondAList = deferred<Post[]>();
    const pendingBList = deferred<Post[]>();
    const oldAPost: Post = {
      ...initialPosts[0],
      id: uuid(301),
      title: "Resultado antigo do repositório A",
    };
    const freshAPost: Post = {
      ...initialPosts[1],
      id: uuid(302),
      title: "Resultado atual do repositório A",
    };
    const bPost: Post = {
      ...initialPosts[0],
      id: uuid(303),
      title: "Resultado obsoleto do repositório B",
    };
    const listA = vi
      .fn<PostsRepository["list"]>()
      .mockImplementationOnce(() => firstAList.promise)
      .mockImplementationOnce(() => secondAList.promise);
    const createA = vi.fn<PostsRepository["create"]>();
    const repositoryA: PostsRepository = { create: createA, list: listA };
    const createB = vi.fn<PostsRepository["create"]>();
    const listB = vi.fn(() => pendingBList.promise);
    const repositoryB: PostsRepository = { create: createB, list: listB };
    const { rerender } = render(<App repository={repositoryA} />);

    await act(async () => {
      firstAList.resolve([oldAPost]);
      await firstAList.promise;
    });

    expect(screen.getByText(getPostTitle(oldAPost))).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: /Criar publicação/i }),
    );
    await user.type(
      screen.getByRole("textbox", { name: /^Legenda/ }),
      "Envio deve permanecer bloqueado durante a nova geração.",
    );

    const submitButton = screen.getByRole("button", {
      name: "Agendar publicação",
    });
    const form = submitButton.closest("form");
    expect(form).not.toBeNull();
    expect(submitButton).toBeEnabled();

    rerender(<App repository={repositoryB} />);

    expect(listB).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("heading", {
        level: 3,
        name: "Carregando publicações",
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText(getPostTitle(oldAPost))).not.toBeInTheDocument();

    rerender(<App repository={repositoryA} />);

    expect(listA).toHaveBeenCalledTimes(2);
    expect(submitButton).toBeDisabled();

    await act(async () => {
      pendingBList.resolve([bPost]);
      await pendingBList.promise;
    });

    expect(
      screen.getByRole("heading", {
        level: 3,
        name: "Carregando publicações",
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText(getPostTitle(bPost))).not.toBeInTheDocument();
    expect(submitButton).toBeDisabled();

    fireEvent.submit(form!);
    expect(createA).not.toHaveBeenCalled();
    expect(createB).not.toHaveBeenCalled();

    await act(async () => {
      secondAList.resolve([freshAPost]);
      await secondAList.promise;
    });

    expect(await screen.findByText(getPostTitle(freshAPost))).toBeInTheDocument();
    expect(screen.queryByText(getPostTitle(oldAPost))).not.toBeInTheDocument();
    expect(screen.queryByText(getPostTitle(bPost))).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", {
        level: 3,
        name: "Carregando publicações",
      }),
    ).not.toBeInTheDocument();
    expect(submitButton).toBeEnabled();
  });

  it("ignora dois submits rápidos enquanto a criação está pendente", async () => {
    const user = userEvent.setup();
    const pendingCreate = deferred<Post>();
    const create = vi
      .fn<PostsRepository["create"]>()
      .mockImplementation(() => pendingCreate.promise);
    const repository: PostsRepository = {
      create,
      list: vi.fn().mockResolvedValue(initialPosts),
    };

    render(<App repository={repository} />);

    await user.click(
      screen.getByRole("button", { name: /Criar publicação/i }),
    );
    await user.type(
      screen.getByRole("textbox", { name: /^Legenda/ }),
      "Envio protegido contra duplicação.",
    );

    const submitButton = screen.getByRole("button", {
      name: "Agendar publicação",
    });
    const form = submitButton.closest("form");

    await waitFor(() => expect(submitButton).toBeEnabled());
    expect(form).not.toBeNull();

    fireEvent.submit(form!);
    fireEvent.submit(form!);

    expect(create).toHaveBeenCalledTimes(1);
    expect(submitButton).toBeDisabled();
    expect(submitButton).toHaveAttribute("aria-busy", "true");

    await act(async () => {
      pendingCreate.resolve(createdPost);
      await pendingCreate.promise;
    });

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Publicação agendada com sucesso!",
    );
    expect(create).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole("heading", {
        level: 2,
        name: "Criar publicação",
      }),
    ).not.toBeInTheDocument();
  });

  it("preserva edições feitas enquanto uma criação está pendente", async () => {
    const user = userEvent.setup();
    const pendingCreate = deferred<Post>();
    const create = vi.fn(() => pendingCreate.promise);
    const repository: PostsRepository = {
      create,
      list: vi.fn().mockResolvedValue(initialPosts),
    };
    const originalCaption = "Versão original do Composer.";
    const revisedCaption = "Versão revisada durante o envio.";
    const originalDate = "2026-08-14";
    const revisedDate = "2026-08-20";
    const expectedOriginalPayload = {
      caption: originalCaption,
      scheduledFor: new Date(2026, 7, 14, 11, 15).toISOString(),
      status: "scheduled",
      title: "Versão original do Composer",
    };

    render(<App repository={repository} />);

    await user.click(
      screen.getByRole("button", { name: /Criar publicação/i }),
    );

    const captionInput = screen.getByRole("textbox", { name: /^Legenda/ });
    const dateInput = screen.getByLabelText("Data");
    const timeInput = screen.getByLabelText("Horário");
    const submitButton = screen.getByRole("button", {
      name: "Agendar publicação",
    });
    const form = submitButton.closest("form");

    fireEvent.change(captionInput, { target: { value: originalCaption } });
    fireEvent.change(dateInput, { target: { value: originalDate } });
    fireEvent.change(timeInput, { target: { value: "11:15" } });
    await waitFor(() => expect(submitButton).toBeEnabled());
    expect(form).not.toBeNull();

    fireEvent.submit(form!);

    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(expectedOriginalPayload);

    fireEvent.change(captionInput, { target: { value: revisedCaption } });
    fireEvent.change(dateInput, { target: { value: revisedDate } });
    fireEvent.change(timeInput, { target: { value: "18:45" } });
    fireEvent.submit(form!);

    expect(create).toHaveBeenCalledTimes(1);

    await act(async () => {
      pendingCreate.resolve(createdPost);
      await pendingCreate.promise;
    });

    expect(screen.getByText(getPostTitle(createdPost))).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: "Criar publicação" }),
    ).toBeInTheDocument();
    expect(captionInput).toHaveValue(revisedCaption);
    expect(dateInput).toHaveValue(revisedDate);
    expect(timeInput).toHaveValue("18:45");
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(expectedOriginalPayload);
  });

  it("mantém uma nova sessão do Composer após uma submissão antiga resolver", async () => {
    const user = userEvent.setup();
    const pendingCreate = deferred<Post>();
    const create = vi
      .fn<PostsRepository["create"]>()
      .mockImplementation(() => pendingCreate.promise);
    const repository: PostsRepository = {
      create,
      list: vi.fn().mockResolvedValue(initialPosts),
    };
    const newDraft = "Rascunho iniciado em uma nova sessão do Composer.";

    render(<App repository={repository} />);

    await user.click(
      screen.getByRole("button", { name: /Criar publicação/i }),
    );
    const firstCaption = screen.getByRole("textbox", { name: /^Legenda/ });
    const firstSubmit = screen.getByRole("button", {
      name: "Agendar publicação",
    });

    await user.type(firstCaption, "Publicação enviada pela sessão antiga.");
    await waitFor(() => expect(firstSubmit).toBeEnabled());
    await user.click(firstSubmit);

    expect(create).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Fechar" }));
    await user.click(
      screen.getByRole("button", { name: /Criar publicação/i }),
    );

    const newCaption = screen.getByRole("textbox", { name: /^Legenda/ });
    await user.type(newCaption, newDraft);

    await act(async () => {
      pendingCreate.resolve(createdPost);
      await pendingCreate.promise;
    });

    expect(
      screen.getByRole("heading", { level: 2, name: "Criar publicação" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /^Legenda/ })).toHaveValue(
      newDraft,
    );
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("acessa diretamente uma rota", () => {
    window.location.hash = "#/analises";

    render(<App />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Análises" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Alcance por semana")).toBeInTheDocument();
  });

  it("identifica uma rota em caixa alta como ativa", () => {
    window.location.hash = "#/AGENDA";

    render(<App />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Agenda de conteúdo" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Agenda/ })).toHaveClass(
      "active",
    );
    expect(
      screen.queryByRole("heading", { name: "Página não encontrada" }),
    ).not.toBeInTheDocument();
  });

  it("identifica uma rota codificada com a semântica do React Router", () => {
    window.location.hash = "#/%61genda";

    render(<App />);

    expect(
      screen.getByRole("heading", { level: 2, name: "Calendário editorial" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 1, name: "Agenda de conteúdo" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Agenda/ })).toHaveClass(
      "active",
    );
    expect(
      screen.getByRole("button", { name: /Criar publicação/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Página não encontrada" }),
    ).not.toBeInTheDocument();
  });

  it.each([
    ["#/", "Olá, Davi! 👋"],
    ["#/agenda", "Agenda de conteúdo"],
    ["#/publicacoes", "Publicações"],
    ["#/analises", "Análises"],
    ["#/canais", "Canais conectados"],
    ["#/configuracoes", "Configurações"],
  ])("mantém a interface na rota %s", (hash, title) => {
    window.location.hash = hash;

    render(<App />);

    expect(
      screen.getByRole("heading", { level: 1, name: title }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("navigation", { name: "Navegação principal" }),
    ).toBeInTheDocument();
  });

  it("exibe a página 404 para uma rota inexistente", () => {
    window.location.hash = "#/rota-inexistente";

    render(<App />);

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Página não encontrada",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Voltar à visão geral" }),
    ).toBeInTheDocument();
  });

  it("fecha o menu móvel ao navegar", async () => {
    const user = userEvent.setup();
    render(<App />);

    const navigation = screen.getByRole("navigation", {
      name: "Navegação principal",
    });
    const sidebar = navigation.closest("aside");

    await user.click(screen.getByRole("button", { name: "Abrir menu" }));
    expect(sidebar).toHaveClass("mobile-open");

    await user.click(screen.getByRole("button", { name: /Agenda/ }));
    expect(sidebar).not.toHaveClass("mobile-open");
    expect(window.location.hash).toBe("#/agenda");
  });

  it("fecha o menu móvel ao navegar pelo histórico do navegador", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: /Agenda/ }));
    await screen.findByRole("heading", {
      level: 1,
      name: "Agenda de conteúdo",
    });

    const navigation = screen.getByRole("navigation", {
      name: "Navegação principal",
    });
    const sidebar = navigation.closest("aside");

    await user.click(screen.getByRole("button", { name: "Abrir menu" }));
    expect(sidebar).toHaveClass("mobile-open");

    act(() => window.history.back());

    await waitFor(() => expect(window.location.hash).toBe("#/"));
    expect(sidebar).not.toHaveClass("mobile-open");
    expect(
      screen.getByRole("heading", { level: 1, name: "Olá, Davi! 👋" }),
    ).toBeInTheDocument();

    act(() => window.history.forward());

    await waitFor(() => expect(window.location.hash).toBe("#/agenda"));
    expect(sidebar).not.toHaveClass("mobile-open");
  });
});
