import type { IncomingMessage } from "node:http";
import type { PostgresAuthService } from "./authService.ts";

export type PostsContext = {
  authorUserId: string;
  tenantId: string;
};

export interface PostsContextResolver {
  resolve(request: IncomingMessage): Promise<PostsContext> | PostsContext;
}

export class AuthenticatedPostsContextResolver
  implements PostsContextResolver
{
  private readonly authService: PostgresAuthService;

  constructor(authService: PostgresAuthService) {
    this.authService = authService;
  }

  async resolve(request: IncomingMessage): Promise<PostsContext> {
    const auth = await this.authService.require(request);
    return {
      authorUserId: auth.user.id,
      tenantId: auth.tenant.id,
    };
  }
}
