import {
  type command_type,
  parse_command_type,
} from "schemata/generated/command_type";

import { type event_type } from "schemata/generated/event_type";
import { type object_type } from "schemata/generated/object_type";
import { parse_object_type } from "schemata/generated/object_type";
import { sleep } from "./sleep.ts";
import axios from "axios";
import { difference } from "./set-functions.ts";
import { customAlphabet } from "nanoid";
import { type objects } from "./objects.ts";
import { v4 as uuidv4 } from "uuid";

const nanoid = customAlphabet("1234567890abcdef", 16);
const email_host_name = process.env["EMAIL_HOST_NAME"];
if (!email_host_name) throw new Error("EMAIL_HOST_NAME is undefined");

type fetch_func<k> = {
  type: k;
  id: string;
  sk: (v: object_val<k>) => command_outcome;
  fk: () => command_outcome;
};

type fetch_desc = fetch_func<object_type["type"]>;
type object_val<T> = (object_type & { type: T })["data"];

function fetch<T extends object_type["type"]>(
  type: T,
  id: string,
  sk: (val: object_val<T>) => command_outcome,
  fk?: () => command_outcome
): command_outcome {
  return {
    type: "fetch",
    desc: {
      type,
      id,
      sk: (v) => sk(v as any),
      fk: fk ?? (() => ({ type: "failed", reason: "not found" })),
    },
  };
}

type command_outcome =
  | { type: "fetch"; desc: fetch_desc }
  | terminal_command_outcome;

export type terminal_command_outcome =
  | { type: "succeeded"; events: event_type[] }
  | { type: "failed"; reason: string };

function succeed(events: event_type[]): terminal_command_outcome {
  return { type: "succeeded", events };
}

function fail(reason: string): terminal_command_outcome {
  return { type: "failed", reason };
}

type dispatch<k extends command_type["type"]> = (
  args: (command_type & { type: k })["data"],
  meta: { user_id: string | undefined }
) => command_outcome;

type command_rules = {
  [k in command_type["type"]]: <R>(inspect: inspector<k, R>) => R;
};

type inspector<T extends command_type["type"], R> = (args: {
  handler: dispatch<T>;
}) => R;

type Command<T extends command_type["type"]> = <R>(
  inspector: inspector<T, R>
) => R;

function Command<T extends command_type["type"]>(args: {
  handler: dispatch<T>;
}) {
  return <R>(inspect: inspector<T, R>) => inspect(args);
}

function check_role(
  { user_id }: { user_id: string | undefined },
  role: objects["user_roles"]["roles"][0],
  f: () => command_outcome
): command_outcome {
  if (!user_id) return fail("unauthorized");
  return fetch(
    "role_users",
    role,
    ({ user_ids }) => (user_ids.includes(user_id) ? f() : fail("unauthorized")),
    () => fail("invalid_role")
  );
}

function welcome_email_events({
  user_id,
  email,
}: {
  user_id: string;
  email: string;
}): event_type[] {
  const code = nanoid(16);
  const message_id = uuidv4();
  return [
    {
      type: "email_confirmation_code_generated",
      data: {
        user_id,
        email,
        code,
      },
    },
    {
      type: "email_message_enqueued",
      data: {
        user_id,
        email,
        message_id,
        content: {
          type: "welcome_email",
          code,
        },
      },
    },
  ];
}

function username_and_email_error(
  username: string,
  email: string
): command_outcome | undefined {
  if (username !== username.toLowerCase()) {
    return fail("invalid_username");
  }
  if (email !== email.toLowerCase()) {
    return fail("invalid_email");
  }
  return undefined;
}

type meta = { user_id: string | undefined };

function check_profile_edit_capability(
  user_id: string,
  meta: meta,
  f: () => command_outcome
): command_outcome {
  if (!meta.user_id) return fail("auth_required");
  if (user_id === meta.user_id) return f();
  return check_role(meta, "profile-management", f);
}

function assert_string(x: any): asserts x is string {
  if (typeof x !== "string") throw new Error("not a string");
}

const command_rules: command_rules = {
  register: Command({
    handler: ({ user_id, email, password, username, realname }) =>
      username_and_email_error(username, email) ||
      fetch(
        "user",
        user_id,
        () => fail("user_id already taken"),
        () =>
          fetch(
            "email",
            email,
            () => fail("email already taken"),
            () =>
              fetch(
                "username",
                username,
                () => fail("username already taken"),
                () =>
                  fetch(
                    "role_users",
                    "admin",
                    (_existingdata) =>
                      // normal registration workflow
                      succeed([
                        {
                          type: "user_registered",
                          data: {
                            user_id,
                            username,
                            realname,
                            email,
                            password,
                          },
                        },
                        ...welcome_email_events({ user_id, email }),
                      ]),
                    () =>
                      // admin registration workflow
                      succeed([
                        {
                          type: "user_registered",
                          data: {
                            user_id,
                            username,
                            realname,
                            email,
                            password,
                          },
                        },
                        {
                          type: "user_roles_changed",
                          data: { user_id, roles: ["admin"] },
                        },
                      ])
                  )
              )
          )
      ),
  }),
  change_user_roles: Command({
    handler: ({ user_id, roles: new_roles }, auth) => {
      function check(old_roles: string[]): command_outcome {
        const added_roles = difference(new_roles, old_roles);
        const removed_roles = difference(old_roles, new_roles);
        if (added_roles.length === 0 && removed_roles.length === 0) {
          return fail("no changes");
        } else {
          return succeed([
            { type: "user_roles_changed", data: { user_id, roles: new_roles } },
          ]);
        }
      }
      return check_role(auth, "admin", () =>
        fetch(
          "user_roles",
          user_id,
          (user) => check(user.roles),
          () => check([])
        )
      );
    },
  }),
  receive_email_confirmation_code: Command({
    handler: ({ code }) =>
      fetch("email_confirmation_code", code, ({ received }) =>
        received
          ? fail("already_received")
          : succeed([
              { type: "email_confirmation_code_received", data: { code } },
            ])
      ),
  }),
  dequeue_email_message: Command({
    handler: ({ message_id, status }, meta) =>
      check_role(meta, "automation", () =>
        fetch("email_message", message_id, ({ status: existing_status }) =>
          existing_status.type === "queued"
            ? succeed([
                {
                  type: "email_message_dequeued",
                  data: { message_id, status },
                },
              ])
            : fail(`already_${existing_status.type}`)
        )
      ),
  }),
  change_email: Command({ handler: () => fail("not implemented") }),
  change_username: Command({ handler: () => fail("not implemented") }),
  change_realname: Command({
    handler: ({ new_realname, user_id }, meta) => {
      if (!meta.user_id) return fail("auth_required");
      user_id = user_id ?? meta.user_id;
      return check_profile_edit_capability(user_id, meta, () =>
        fetch("user", user_id, ({ realname }) =>
          realname === new_realname
            ? fail("name did not change")
            : succeed([
                {
                  type: "user_realname_changed",
                  data: { user_id, new_realname },
                },
              ])
        )
      );
    },
  }),
  ping: Command({
    handler: ({}) => succeed([{ type: "ping", data: {} }]),
  }),
  create_board: Command({
    handler: ({ board_id, board_name }, { user_id }) =>
      user_id
        ? fetch(
            "board",
            board_id,
            () => fail("board already exists"),
            () =>
              succeed([
                {
                  type: "board_created",
                  data: { board_id, board_name, user_id },
                },
              ])
          )
        : fail("auth required"),
  }),
  rename_board: Command({
    handler: ({ board_id, board_name }, { user_id }) =>
      fetch("board", board_id, (board) =>
        board.user_id === user_id
          ? succeed([{ type: "board_renamed", data: { board_id, board_name } }])
          : fail("not an owner")
      ),
  }),
};

type fetch_result = { found: false } | { found: true; data: any };
async function fetch_object(type: string, id: string): Promise<fetch_result> {
  while (true) {
    try {
      const result = await axios.get(
        `http://object-reducer:3000/object-apis/get-object?type=${encodeURIComponent(
          type
        )}&id=${encodeURIComponent(id)}`
      );
      return result.data as any;
    } catch (error: any) {
      console.error(error);
      await sleep(1000);
    }
  }
}

async function finalize(
  out: command_outcome
): Promise<terminal_command_outcome> {
  switch (out.type) {
    case "fetch": {
      const { type, id, sk, fk } = out.desc;
      const res = await fetch_object(type, id);
      if (res.found) {
        const o = parse_object_type({ type, data: res.data });
        return finalize(sk(o.data));
      } else {
        return finalize(fk());
      }
    }
    case "succeeded":
    case "failed":
      return out;
    default:
      const invalid: never = out;
      throw invalid;
  }
}

export async function process_command(
  command: {
    type: string;
    data: any;
  },
  meta: { user_id: string | undefined }
): Promise<terminal_command_outcome> {
  const c = (() => {
    try {
      return parse_command_type(command);
    } catch (error) {
      return undefined;
    }
  })();
  if (c === undefined) return { type: "failed", reason: "invalid command" };
  const insp = command_rules[c.type];
  return finalize(insp(({ handler }) => handler(c.data as any, meta)));
}
