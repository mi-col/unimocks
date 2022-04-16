import {
  InteractionObject,
  RequestOptions,
  ResponseOptions,
  Matchers,
} from "@pact-foundation/pact";
import { MetaAPIRequest, APIRequestInput, APIRequestOutput, MetaAPIRequests, MetaAPIService } from ".";

/** Pact matcher object */
export interface MatcherResult<T> {
  getValue(): T;
}
/** Pact array matcher object */
export interface ArrayMatcherResult<T> extends MatcherResult<T> {
  min: number;
}
export function isMatcher<T = any>(
  matcher: MatcherResult<T> | any
): matcher is MatcherResult<T> {
  return !!matcher && typeof matcher.getValue === "function";
}
export function isArrayMatcher<T = any>(
  matcher: ArrayMatcherResult<T> | any
): matcher is ArrayMatcherResult<T> {
  return !!matcher && typeof matcher.getValue === "function" && matcher.min;
}
/** An object used to match a certain type, with all fields potentially pact matchers */
export type MatcherObject<T extends Object> = {
  [Field in keyof T]:
    | T[Field]
    | MatcherResult<T[Field]>
    | MatcherObject<T[Field]>;
};
/** A value or matcher to be used to generate the input of an interaction */
export type InteractionInput<T> = T | MatcherResult<T> | MatcherObject<T>;

/** A method that builds an interaction */
export type InteractionBuilder<Request extends MetaAPIRequest<any, any>> =
  (options: {
    state: string;
    uponReceiving: string;
    input: InteractionInput<APIRequestInput<Request>>;
    request?: Partial<RequestOptions>;
    response?: Partial<ResponseOptions>;
    noMatchFields?: string[];
    exclusiveMatchFields?: string[];
  }) => Promise<{
    interaction: InteractionObject;
    input: APIRequestInput<Request>;
    output: APIRequestOutput<Request>;
  }>;

/** A map of interaction builders for a given service */
export type ServiceInteractionBuilders<API extends MetaAPIRequests> = {
  [Request in keyof API]: InteractionBuilder<API[Request]>;
};

const isObject = (item: any) => {
  return item && typeof item === "object" && !Array.isArray(item);
};

const deepMerge = <T>(target: T, source: T): T => {
  let output = Object.assign({}, target);
  if (isObject(target) && isObject(source)) {
    Object.keys(source).forEach((k: any) => {
      const key: keyof T = k as any;
      if (isObject(source[key])) {
        if (!(key in target)) {
          Object.assign(output, { [key]: source[key] });
        } else {
          output[key] = deepMerge(target[key], source[key]);
        }
      } else {
        Object.assign(output, { [key]: source[key] });
      }
    });
  }
  return output;
};

const buildPath = (field: string, path?: string) =>
  path ? `${path}.${field}` : field;

const reduceToMatchers = (
  item: any,
  options?: {
    path?: string;
    noMatchFields?: string[];
    exclusiveMatchFields?: string[];
  }
): any =>
  Object.keys(item).reduce((matchers, key) => {
    const path = buildPath(key, options?.path);
    let isMatcherizable = true;
    if (options?.exclusiveMatchFields?.length) {
      isMatcherizable = options.exclusiveMatchFields.some(
        (field) => field === path
      );
    } else if (options?.noMatchFields?.some((field) => field === path)) {
      isMatcherizable = false;
    }
    return {
      ...matchers,
      [key]: isMatcherizable
        ? matcherize(item[key], { ...options, path })
        : item[key],
    };
  }, {});

const matcherize = (
  item: any,
  options?: {
    path?: string;
    noMatchFields?: string[];
    exclusiveMatchFields?: string[];
  }
): any => {
  if (options?.noMatchFields?.includes("*")) {
    return item;
  }
  if (typeof item !== "object") {
    return Matchers.somethingLike(item);
  } else {
    if (Array.isArray(item)) {
      if (item.length) {
        return item.map((subitem) => reduceToMatchers(subitem, options));
      } else {
        return Matchers.somethingLike(item);
      }
    } else {
      return reduceToMatchers(item, options);
    }
  }
};

const getMatcherValue = <T>(matcher: InteractionInput<T>): T => {
  if (isMatcher<T>(matcher)) {
    if (isArrayMatcher<T>(matcher)) {
      return Array.from(new Array(matcher.min).keys()).map(() =>
        getMatcherValue(matcher.getValue())
      ) as any as T;
    }
    return getMatcherValue(matcher.getValue());
  }
  if (Array.isArray(matcher)) {
    return matcher.map((item) => getMatcherValue(item)) as any as T;
  }
  if (typeof matcher === "object") {
    return Object.keys(matcher).reduce(
      (values, key) => ({
        ...values,
        [key]: getMatcherValue(matcher[key as keyof T]),
      }),
      {} as T
    );
  }
  return matcher;
};

/** Method to set up interactions builders for the given API service */
export const setupInteractionBuilders = <API extends MetaAPIRequests>(
  service: MetaAPIService<API>,
  options?: {
    /** A function to reset your environment after an interaction was generated. For example resetting your data factories to generate consistent data */
    resetEnv?: VoidFunction;
  }
) => {
  const builders = Object.keys(service.meta).reduce(
    (interactions, key: keyof API) => {
      const req = service.requests[key];
      const metadata = service.meta[key];
      const mock = service.mocks[key];
      const build: InteractionBuilder<APIRequestInput<typeof req>> = async (
        interactionOptions
      ) => {
        const { state, uponReceiving, request, response } = interactionOptions;
        const input = getMatcherValue(interactionOptions.input);
        const output = await mock(input);
        options?.resetEnv?.();
        return {
          input,
          output,
          interaction: {
            state,
            uponReceiving,
            withRequest: {
              method: metadata.method(input) as any,
              path: metadata.path(input),
              query: metadata.query(input),
              headers: metadata.headers(input),
              body: metadata.body(input),
              ...request,
            },
            willRespondWith: deepMerge<ResponseOptions>(
              {
                status: 200,
                headers: {
                  "Content-Type": "application/json",
                },
                body: matcherize(output),
              },
              response as ResponseOptions
            ),
          },
        };
      };
      return {
        ...interactions,
        [key]: build,
      };
    },
    {} as ServiceInteractionBuilders<API>
  );
  service.mocks = {} as any;
  return builders;
};
