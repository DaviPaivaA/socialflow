import { useMemo, useState } from "react";
import { Toast } from "./components/Toast";
import { initialPosts, titles } from "./data/mockData";
import { Composer } from "./features/composer/Composer";
import { MainLayout } from "./layout/MainLayout";
import { Agenda } from "./pages/Agenda";
import { Analytics } from "./pages/Analytics";
import { Channels } from "./pages/Channels";
import { Overview } from "./pages/Overview";
import { Posts } from "./pages/Posts";
import { Settings } from "./pages/Settings";
import type { NavKey, Post } from "./types/social";

export default function Home() {
  const [active, setActive] = useState<NavKey>("overview");
  const [posts, setPosts] = useState(initialPosts);
  const [composerOpen, setComposerOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [mobileNav, setMobileNav] = useState(false);

  const current = useMemo(() => titles[active], [active]);

  const navigate = (view: NavKey) => {
    setActive(view);
    setMobileNav(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const schedulePost = (post: Post) => {
    setPosts((currentPosts) => [post, ...currentPosts]);
    setComposerOpen(false);
    setToast("Publicação agendada com sucesso!");
    setTimeout(() => setToast(""), 3500);
  };

  const openComposer = () => setComposerOpen(true);

  return (
    <MainLayout
      active={active}
      mobileNavOpen={mobileNav}
      overlays={
        <>
          {composerOpen && (
            <Composer
              onClose={() => setComposerOpen(false)}
              onSchedule={schedulePost}
            />
          )}
          {toast && <Toast message={toast} />}
        </>
      }
      pageTitle={current}
      onCompose={openComposer}
      onNavigate={navigate}
      onToggleMenu={() => setMobileNav((open) => !open)}
    >
      {active === "overview" && (
        <Overview posts={posts} onCompose={openComposer} goTo={navigate} />
      )}
      {active === "agenda" && <Agenda onCompose={openComposer} />}
      {active === "posts" && (
        <Posts posts={posts} onCompose={openComposer} />
      )}
      {active === "analytics" && <Analytics />}
      {active === "channels" && <Channels />}
      {active === "settings" && <Settings />}
    </MainLayout>
  );
}
