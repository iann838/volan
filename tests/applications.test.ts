import { z } from "zod"
import type { ExecutionContext } from "@cloudflare/workers-types"

import { App, Router } from "../src"
import { Dependency } from "../src/dependencies"
import { createObjectPartial } from "../src/helpers"
import { CORSMiddleware, CompressMiddleware } from "../src/middleware"
import { Body, Cookie, Depends, Header, Path, Query, Responds } from "../src/parameters"
import { JSONResponse, PlainTextResponse } from "../src/responses"

const app = new App<undefined>({
    middleware: [
        CompressMiddleware("gzip"),
        CORSMiddleware({ origin: ["http://a.co"] })
    ],
})
const appAlt = new App<undefined>({
    rootPath: "/alt",
    middleware: [
        CompressMiddleware("gzip"),
        CORSMiddleware({ origin: ["http://a.co"] })
    ],
})
const cfargs = {
    env: undefined,
    ctx: undefined as unknown as ExecutionContext,
}
const requireAuthSession = new Dependency({
    of: app,
    name: "requireAuthSession",
    parameters: {
        authorization: Header(z.string()),
    },
    handle: async ({ authorization }) => {
        if (authorization == "iminvalid")
            throw new JSONResponse({ detail: "Invalid Authentication" }, { status: 403 })
        return { id: 123, token: authorization }
    },
})
const testNestedDependencyNested = new Dependency({
    parameters: {
        one: Query(z.string()),
        two: Query(z.string())
    },
    handle: ({ one, two }) => {
        return { one, two }
    }
})
const testNestedDependency = new Dependency({
    parameters: {
        three: Depends(testNestedDependencyNested),
        zero: Query(z.number())
    },
    handle: ({ three, zero }) => {
        return { three, zero }
    }
})

app.get("/hello-world", {
    responseClass: PlainTextResponse,
    parameters: {
        testOpenAPI: Query(z.number().array()),
    },
    handle: () => "Hello World!",
})
app.get("/cookie-yummy", {
    responseClass: PlainTextResponse,
    parameters: {
        yummy: Cookie(z.string()),
    },
    handle: ({ yummy }) => yummy,
})
app.get("/test-nested-dependencies", {
    parameters: {
        depends: Depends(testNestedDependency),
    },
    handle: ({ depends }) => depends,
})
app.get("/", {
    parameters: {},
    handle() {
        return { message: "Hello World" }
    },
})
app.get("/items/{itemId}", {
    parameters: {
        itemId: Path(z.number().int().min(0)),
        q: Query(z.string().optional()),
    },
    handle: ({ itemId, q }) => {
        return { itemId, q }
    },
})

const todoRoute = app.post("/projects/{projectId}/todos", {
    tags: ["Todos"],
    summary: "Create project todos",
    description: "Create a todo for a project",
    deprecated: false,
    includeInSchema: true,
    statusCode: 200,
    responseClass: JSONResponse,
    responses: {
        200: Responds(z.object({ params: z.any({}) }), {
            description: "Returns received params",
        }),
        403: Responds(z.object({ detail: z.string() })),
        409: Responds(z.object({ detail: z.string() })),
    },
    parameters: {
        projectId: Path(z.number()),
        trackId: Query(z.string()),
        X_Rate_Limit: Header(z.string()),
        todoItem: Body(
            z.object({
                id: z.string(),
                title: z.string(),
                description: z.string(),
            })
        ),
        session: Depends(requireAuthSession),
    },
    handle: ({ projectId, trackId, X_Rate_Limit, todoItem, session }) => {
        if (trackId == "throwme")
            throw new JSONResponse({ detail: "Thrown trackId" }, { status: 409 })
        return {
            params: { projectId, trackId, X_Rate_Limit, todoItem, session },
        }
    },
})
appAlt.post("/projects/{projectId}/todos", todoRoute)
app.put("/hello-world", {
    responseClass: PlainTextResponse,
    parameters: {
        testOpenAPI: Query(z.boolean().array()),
        blobBody: Body(Blob),
    },
    handle: () => "Hello World!",
})
app.delete("/hello-world", {
    responseClass: PlainTextResponse,
    parameters: {
        testOpenAPI: Query(z.enum(["blue", "green", "red", "black", "white"]).array()),
        textBody: Body(String),
    },
    handle: () => "Hello World!",
})
app.patch("/hello-world", {
    responseClass: PlainTextResponse,
    parameters: {
        testOpenAPI: Query(
            z.nativeEnum({ blue: 10, green: 20, red: 30, black: 40, white: 50 }).array()
        ),
        streamBody: Body(ReadableStream),
    },
    handle: () => "Hello World!",
})
app.trace("/hello-world", {
    responseClass: PlainTextResponse,
    parameters: {},
    handle: () => "Hello World!",
})
app.options("/hello-world", {
    responseClass: PlainTextResponse,
    parameters: {},
    handle: () => "Hello World!",
})

const subapp = new Router<undefined>({})
subapp.get("/hello-world", {
    responseClass: PlainTextResponse,
    parameters: {
        testOpenAPI: Query(z.number().array()),
    },
    handle: () => "Hello World!",
})

app.include("/subpath", subapp)
appAlt.include("/subpath", subapp)

const appAltPartial = createObjectPartial({
    altHeader: Header(z.string())
})

appAlt.get("/hello-world-2", {
    responseClass: PlainTextResponse,
    parameters: appAltPartial({
        testOpenAPI: Query(z.number().array()),
    }),
    handle: ({ altHeader, testOpenAPI }) => "Hello World!",
})

describe("class App", () => {
    test("[method] handle: success", async () => {
        const res1 = await app.handle({
            req: new Request("http://a.co/projects/123/todos?trackId=abc", {
                method: "POST",
                body: JSON.stringify({
                    id: "iid",
                    title: "ititle",
                    description: "idesc",
                }),
                headers: {
                    "X-Rate-Limit": "20:100",
                    authorization: "Bearer myauthtoken",
                },
            }),
            ...cfargs,
        })
        expect(res1).toBeTruthy()
        expect(res1.status).toBe(200)
        expect(await res1.json()).toEqual({
            params: {
                projectId: 123,
                trackId: "abc",
                X_Rate_Limit: "20:100",
                todoItem: {
                    id: "iid",
                    title: "ititle",
                    description: "idesc",
                },
                session: {
                    id: 123,
                    token: "Bearer myauthtoken",
                },
            },
        })
        expect(res1.headers.get("Access-Control-Allow-Origin")).toBe("http://a.co")
    })

    test("[method] handle: success cors reject", async () => {
        const res1 = await app.handle({
            req: new Request("http://b.co/projects/123/todos?trackId=abc", {
                method: "POST",
                body: JSON.stringify({
                    id: "iid",
                    title: "ititle",
                    description: "idesc",
                }),
                headers: {
                    "X-Rate-Limit": "20:100",
                    authorization: "Bearer myauthtoken",
                },
            }),
            ...cfargs,
        })
        expect(res1).toBeTruthy()
        expect(res1.status).toBe(200)
        expect(await res1.json()).toEqual({
            params: {
                projectId: 123,
                trackId: "abc",
                X_Rate_Limit: "20:100",
                todoItem: {
                    id: "iid",
                    title: "ititle",
                    description: "idesc",
                },
                session: {
                    id: 123,
                    token: "Bearer myauthtoken",
                },
            },
        })
        expect(res1.headers.get("Access-Control-Allow-Origin")).not.toBe("http://b.co")
    })

    test("[method] handle: success gzip", async () => {
        const res1 = await app.handle({
            req: new Request("http://a.co/projects/123/todos?trackId=abc", {
                method: "POST",
                body: JSON.stringify({
                    id: "iid",
                    title: "ititle",
                    description: "idesc",
                }),
                headers: {
                    "X-Rate-Limit": "20:100",
                    authorization: "Bearer myauthtoken",
                    "Accept-Encoding": "gzip",
                },
            }),
            ...cfargs,
        })
        expect(res1).toBeTruthy()
        expect(res1.status).toBe(200)
        const stream = new DecompressionStream("gzip")
        expect(await new Response(res1.body?.pipeThrough(stream)).json()).toEqual({
            params: {
                projectId: 123,
                trackId: "abc",
                X_Rate_Limit: "20:100",
                todoItem: {
                    id: "iid",
                    title: "ititle",
                    description: "idesc",
                },
                session: {
                    id: 123,
                    token: "Bearer myauthtoken",
                },
            },
        })
    })

    test("[method] handle: slash path success", async () => {
        const res1 = await app.handle({ req: new Request("http://a.co/"), ...cfargs })
        expect(res1).toBeTruthy()
        expect(res1.status).toBe(200)
        expect(await res1.json()).toEqual({ message: "Hello World" })
    })

    test("[method] handle: fail path not found", async () => {
        const res2 = await app.handle({ req: new Request("http://a.co/nopath"), ...cfargs })
        expect(res2).toBeTruthy()
        expect(res2.status).toBe(404)
        expect(await res2.json()).toEqual({ detail: "Not Found" })
    })

    test("[method] handle: fail route throw", async () => {
        const res1 = await app.handle({
            req: new Request("http://a.co/projects/123/todos?trackId=throwme", {
                method: "POST",
                body: JSON.stringify({
                    id: "iid",
                    title: "ititle",
                    description: "idesc",
                }),
                headers: {
                    "X-Rate-Limit": "20:100",
                    authorization: "Bearer myauthtoken",
                },
            }),
            ...cfargs,
        })
        expect(res1).toBeTruthy()
        expect(res1.status).toBe(409)
        expect(await res1.json()).toEqual({ detail: "Thrown trackId" })
    })

    test("[method] handle: fail dependency throw", async () => {
        const res1 = await app.handle({
            req: new Request("http://a.co/projects/123/todos?trackId=abc", {
                method: "POST",
                body: JSON.stringify({
                    id: "iid",
                    title: "ititle",
                    description: "idesc",
                }),
                headers: {
                    "X-Rate-Limit": "20:100",
                    authorization: "iminvalid",
                },
            }),
            ...cfargs,
        })
        expect(res1).toBeTruthy()
        expect(res1.status).toBe(403)
        expect(await res1.json()).toEqual({ detail: "Invalid Authentication" })
    })

    test("[method] openapi: return value simple", () => {
        const openapi = app.openapi()
        expect(openapi).toBeTruthy()
        expect(Object.entries(openapi.paths!).length).toBeTruthy()
    })

    test("[method] handle: include success", async () => {
        const res1 = await app.handle({ req: new Request("http://a.co/subpath/hello-world"), ...cfargs })
        expect(res1).toBeTruthy()
        expect(res1.status).toBe(200)
        expect(await res1.text()).toEqual("Hello World!")
    })

    test("[method] handle: root path with prefix success", async () => {
        const res1 = await appAlt.handle({
            req: new Request("http://a.co/alt/projects/123/todos?trackId=abc", {
                method: "POST",
                body: JSON.stringify({
                    id: "iid",
                    title: "ititle",
                    description: "idesc",
                }),
                headers: {
                    "X-Rate-Limit": "20:100",
                    authorization: "Bearer myauthtoken",
                },
            }),
            ...cfargs,
        })
        expect(res1).toBeTruthy()
        expect(res1.status).toBe(200)
        expect(await res1.json()).toEqual({
            params: {
                projectId: 123,
                trackId: "abc",
                X_Rate_Limit: "20:100",
                todoItem: {
                    id: "iid",
                    title: "ititle",
                    description: "idesc",
                },
                session: {
                    id: 123,
                    token: "Bearer myauthtoken",
                },
            },
        })
        expect(res1.headers.get("Access-Control-Allow-Origin")).toBe("http://a.co")
    })

    test("[method] handle: root path without prefix success", async () => {
        const res1 = await appAlt.handle({
            req: new Request("http://a.co/projects/123/todos?trackId=abc", {
                method: "POST",
                body: JSON.stringify({
                    id: "iid",
                    title: "ititle",
                    description: "idesc",
                }),
                headers: {
                    "X-Rate-Limit": "20:100",
                    authorization: "Bearer myauthtoken",
                },
            }),
            ...cfargs,
        })
        expect(res1).toBeTruthy()
        expect(res1.status).toBe(200)
    })

    test("[method] handle: root path without prefix fail", async () => {
        const res1 = await appAlt.handle({
            req: new Request("http://a.co/dirgh/123/todos?trackId=abc", {
                method: "POST",
                body: JSON.stringify({
                    id: "iid",
                    title: "ititle",
                    description: "idesc",
                }),
                headers: {
                    "X-Rate-Limit": "20:100",
                    authorization: "Bearer myauthtoken",
                },
            }),
            ...cfargs,
        })
        expect(res1).toBeTruthy()
        expect(res1.status).toBe(404)
        expect(await res1.json()).toEqual({ detail: "Not Found" })
    })

    test("[method] handle: root path with prefix fail", async () => {
        const res1 = await appAlt.handle({
            req: new Request("http://a.co/alt/dirgh/123/todos?trackId=abc", {
                method: "POST",
                body: JSON.stringify({
                    id: "iid",
                    title: "ititle",
                    description: "idesc",
                }),
                headers: {
                    "X-Rate-Limit": "20:100",
                    authorization: "Bearer myauthtoken",
                },
            }),
            ...cfargs,
        })
        expect(res1).toBeTruthy()
        expect(res1.status).toBe(404)
        expect(await res1.json()).toEqual({ detail: "Not Found" })
    })

    test("[method] handle: root path include success", async () => {
        const res1 = await appAlt.handle({ req: new Request("http://a.co/alt/subpath/hello-world"), ...cfargs })
        expect(res1).toBeTruthy()
        expect(res1.status).toBe(200)
        expect(await res1.text()).toEqual("Hello World!")
    })

    test("[method] handle: nested dependency success", async () => {
        const res1 = await app.handle({
            req: new Request("http://a.co/test-nested-dependencies?zero=1&one=a&two=b"),
            ...cfargs
        })
        expect(res1).toBeTruthy()
        expect(res1.status).toBe(200)
        expect(await res1.json()).toEqual({ zero: 1, three: { one: "a", two: "b" } })
    })

    test("[method] handle: nested dependency fail", async () => {
        const res1 = await app.handle({
            req: new Request("http://a.co/test-nested-dependencies?zero=1"),
            ...cfargs
        })
        expect(res1).toBeTruthy()
        expect(res1.status).toBe(422)
    })

    test("[method] handle: cookie yummy", async () => {
        const res1 = await app.handle({
            req: new Request("http://a.co/cookie-yummy", { headers: { Cookie: "yummy=oreo"} }),
            ...cfargs
        })
        expect(res1).toBeTruthy()
        expect(res1.status).toBe(200)
        expect(await res1.text()).toBe("oreo")
    })

})
