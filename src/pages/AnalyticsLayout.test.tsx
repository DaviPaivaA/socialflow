import { readFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { Analytics } from "./Analytics";

it("mantém o cabeçalho de filtros com altura intrínseca, sem reservar painel vazio",()=>{
  const style=document.createElement("style");
  // Match the application cascade: feature CSS can load before the global panel rule.
  style.textContent=readFileSync("src/features/tiktok/tiktok.css","utf8")+readFileSync("src/index.css","utf8");
  document.head.append(style);
  try{
    render(<Analytics/>);
    const header=screen.getByLabelText("Plataforma de análise").closest("section")!;
    expect(getComputedStyle(header).minHeight).toBe("0px");
    expect(screen.getAllByText("—")).toHaveLength(4);
  }finally{style.remove();}
});

it("informa ausência de métricas sem prometer sincronização ou sugerir dados reais", () => {
  render(<Analytics />);
  expect(screen.getByText("Métricas indisponíveis.")).toBeInTheDocument();
  expect(screen.queryByText(/aguarde.*sincronização|após a sincronização/i)).not.toBeInTheDocument();
  expect(screen.getByText(/nenhuma consulta de métricas/i)).toBeInTheDocument();
  expect(screen.getAllByText("—")).toHaveLength(4);
});
