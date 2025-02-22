import {
  type command_type,
  parse_command_type,
} from "schemata/dist/generated/command_type";

import { type event_type } from "schemata/dist/generated/event_type";
import { type object_type } from "schemata/dist/generated/object_type";

type fetch_func<k> = object_type extends { type: k; value: infer v }
  ? {
      type: k;
      id: string;
      sk: (v: v) => command_outcome;
      fk: () => command_outcome;
    }
  : never;

type fetch_desc = fetch_func<object_type["type"]>;

type command_outcome =
  | { type: "fetch"; desc: fetch_desc }
  | { type: "succeeded"; events: event_type[] }
  | { type: "failed"; reason: string };

type dispatch<k extends command_type["type"]> = (
  args: (command_type & { type: k })["value"]
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
    handler: ({ user_id, email, salted_hash }) => ({
      type: "succeeded",
      events: [
        { type: "user_registered", value: { user_id, email, salted_hash } },
      ],
    }),
  }),
  change_email: Command({
    handler: () => ({ type: "failed" as const, reason: "not implemented" }),
  }),
};

const e = parse_command_type({ type: "register" });
const insp = command_rules[e.type];
const out = insp(({ handler }) => handler(e.value as any));
