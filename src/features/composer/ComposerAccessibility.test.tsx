import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Composer } from "./Composer";

function Fixture() {
  const [open,setOpen]=useState(false);
  return <><button onClick={()=>setOpen(true)}>Abrir compositor de teste</button>{open&&<Composer
    workspaceId="workspace-test" isLoadingPosts={false} isSubmitting={false} onClose={()=>setOpen(false)}
    onDraftChange={vi.fn()} onSubmit={vi.fn()}
    mediaAssetsRepository={{list:async()=>[],upload:vi.fn(),contentUrl:vi.fn()}}
    socialAccountsRepository={{list:async()=>[],get:vi.fn(),update:vi.fn(),disconnect:vi.fn()}}
  />}</>;
}

describe("Composer — navegação acessível Task15",()=>{
  it("identifica o diálogo modal e coloca foco inicial dentro dele",async()=>{
    const user=userEvent.setup();render(<Fixture/>);
    await user.click(screen.getByRole("button",{name:"Abrir compositor de teste"}));
    const dialog=screen.getByRole("dialog",{name:"Criar publicação"});
    expect(dialog).toHaveAttribute("aria-modal","true");
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    expect(screen.getByRole("button",{name:"Fechar"})).toHaveFocus();
  });
  it("envolve Tab e Shift+Tab sem levar o foco ao conteúdo de fundo",async()=>{
    const user=userEvent.setup();render(<Fixture/>);
    await user.click(screen.getByRole("button",{name:"Abrir compositor de teste"}));
    const first=screen.getByRole("button",{name:"Fechar"});
    const last=screen.getByRole("button",{name:"Fechar sem salvar"});
    last.focus();await user.tab();expect(first).toHaveFocus();
    await user.tab({shift:true});expect(last).toHaveFocus();
  });
  it("fecha por Escape e devolve o foco ao botão que abriu o compositor",async()=>{
    const user=userEvent.setup();render(<Fixture/>);
    const opener=screen.getByRole("button",{name:"Abrir compositor de teste"});
    await user.click(opener);await user.keyboard("{Escape}");
    expect(screen.queryByRole("heading",{name:"Criar publicação"})).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });
});
