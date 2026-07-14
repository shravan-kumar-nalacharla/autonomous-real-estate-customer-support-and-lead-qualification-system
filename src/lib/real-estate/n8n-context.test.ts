import { describe, expect, it } from "vitest";
import { resolveRealEstateContext } from "./n8n-context";

const ORG_A = "85b1f316-b942-426e-b3b5-a84988ae717d";
const ORG_B = "ad3d6bc5-9d90-4fa8-9691-716cc4a91018";
const CONTACT_A = "a5ef2c68-98e7-48b4-9e69-977bc313d546";
const CONTACT_B = "b91532a0-4221-43f5-bbe4-f80b0e5e9e79";
const CONVERSATION_A = "ff24823e-a746-4af9-94f0-c54f3876de78";
const CONVERSATION_B = "0971cdbb-35da-423c-8bc1-f1118f256ee0";

const rows = {
  conversations: [
    {
      id: CONVERSATION_A,
      organization_id: ORG_A,
      contact_id: CONTACT_A,
      updated_at: "2026-07-14T10:00:00.000Z",
    },
    {
      id: CONVERSATION_B,
      organization_id: ORG_B,
      contact_id: CONTACT_B,
      updated_at: "2026-07-14T11:00:00.000Z",
    },
  ],
  contacts: [
    {
      id: CONTACT_A,
      organization_id: ORG_A,
      phone: "917993406266",
      name: "Shravan",
    },
    {
      id: CONTACT_B,
      organization_id: ORG_B,
      phone: "14155551212",
      name: "Other",
    },
  ],
};

describe("resolveRealEstateContext", () => {
  it("resolves organization from conversation_id when organization_id is missing", async () => {
    const resolved = await resolveRealEstateContext(mockDb(), {
      conversation_id: CONVERSATION_A,
    });

    expect(resolved).toMatchObject({
      organizationId: ORG_A,
      conversation: { id: CONVERSATION_A },
      contact: { id: CONTACT_A },
    });
  });

  it("resolves organization from contact_id when organization_id is missing", async () => {
    const resolved = await resolveRealEstateContext(mockDb(), {
      contact_id: CONTACT_A,
    });

    expect(resolved).toMatchObject({
      organizationId: ORG_A,
      contact: { id: CONTACT_A },
      conversation: { id: CONVERSATION_A },
    });
  });

  it("resolves organization from customer_phone when organization_id is missing", async () => {
    const resolved = await resolveRealEstateContext(mockDb(), {
      customer_phone: "+91 79934 06266",
    });

    expect(resolved).toMatchObject({
      organizationId: ORG_A,
      contact: { id: CONTACT_A },
      conversation: { id: CONVERSATION_A },
    });
  });

  it("rejects wrong organization_id with a valid conversation", async () => {
    const resolved = await resolveRealEstateContext(mockDb(), {
      organization_id: ORG_B,
      conversation_id: CONVERSATION_A,
    });

    expect(resolved).toMatchObject({
      status: 403,
      error: "Conversation does not belong to organization",
    });
  });

  it("rejects cross-tenant conversation/contact mismatch", async () => {
    const resolved = await resolveRealEstateContext(mockDb(), {
      conversation_id: CONVERSATION_A,
      contact_id: CONTACT_B,
    });

    expect(resolved).toMatchObject({
      status: 403,
      error: "Contact does not belong to organization",
    });
  });

  it("adopts backend organization for placeholder organization_id", async () => {
    const resolved = await resolveRealEstateContext(mockDb(), {
      organization_id: "default-org",
      conversation_id: CONVERSATION_A,
    });

    expect(resolved).toMatchObject({ organizationId: ORG_A });
  });
});

function mockDb() {
  return {
    from(table: keyof typeof rows) {
      return new Query(rows[table]);
    },
  } as never;
}

class Query {
  private filters: Array<{ key: string; value: unknown }> = [];
  private limitCount: number | null = null;
  private orderKey: string | null = null;
  private ascending = true;

  constructor(private readonly data: Array<Record<string, unknown>>) {}

  select() {
    return this;
  }

  eq(key: string, value: unknown) {
    this.filters.push({ key, value });
    return this;
  }

  order(key: string, options?: { ascending?: boolean }) {
    this.orderKey = key;
    this.ascending = options?.ascending ?? true;
    return this;
  }

  limit(count: number) {
    this.limitCount = count;
    return this;
  }

  async maybeSingle() {
    return { data: this.execute()[0] ?? null, error: null };
  }

  then<TResult1 = { data: Array<Record<string, unknown>>; error: null }, TResult2 = never>(
    onfulfilled?:
      | ((
          value: { data: Array<Record<string, unknown>>; error: null },
        ) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) {
    return Promise.resolve({ data: this.execute(), error: null }).then(
      onfulfilled,
      onrejected,
    );
  }

  private execute() {
    let output = this.data.filter((row) =>
      this.filters.every((filter) => row[filter.key] === filter.value),
    );
    if (this.orderKey) {
      output = [...output].sort((a, b) => {
        const left = String(a[this.orderKey!] ?? "");
        const right = String(b[this.orderKey!] ?? "");
        return this.ascending ? left.localeCompare(right) : right.localeCompare(left);
      });
    }
    if (this.limitCount != null) output = output.slice(0, this.limitCount);
    return output;
  }
}
