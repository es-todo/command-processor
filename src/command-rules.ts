import {
  type command_type,
  parse_command_type,
} from "schemata/generated/command_type";

import { type event_type } from "schemata/generated/event_type";
import { type object_type } from "schemata/generated/object_type";
import { parse_object_type } from "schemata/generated/object_type";
import { sleep } from "./sleep.ts";
import axios from "axios";

type fetch_func<k> = {
  type: k;
  id: string;
  sk: (v: object_val<k>) => command_outcome;
  fk: () => command_outcome;
};

type fetch_desc = fetch_func<object_type["type"]>;
type object_val<T> = object_type extends { type: T; data: infer v } ? v : never;

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
  args: (command_type & { type: k })["data"]
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

const command_rules: command_rules = {
  register: Command({
    handler: ({ user_id, email, password }) =>
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
              succeed([
                {
                  type: "user_registered",
                  data: { user_id, email, password },
                },
              ])
          )
      ),
  }),
  change_email: Command({
    handler: () => fail("not implemented"),
  }),
  ping: Command({
    handler: ({}) => succeed([{ type: "ping", data: {} }]),
  }),
};

type fetch_result = { found: false } | { found: true; data: any };
async function fetch_object(type: string, id: string): Promise<fetch_result> {
  while (true) {
    try {
      const result = await axios.get(
        `http://object-reducer:3000/object-apis/get-object?type=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}`
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

export async function process_command(command: {
  type: string;
  data: any;
}): Promise<terminal_command_outcome> {
  const c = (() => {
    try {
      return parse_command_type(command);
    } catch (error) {
      return undefined;
    }
  })();
  if (c === undefined) return { type: "failed", reason: "invalid command" };
  const insp = command_rules[c.type];
  return finalize(insp(({ handler }) => handler(c.data as any)));
}
