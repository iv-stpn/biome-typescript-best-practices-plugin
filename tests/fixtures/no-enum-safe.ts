const Color = { Red: "red", Green: "green", Blue: "blue" } as const;
type Color = (typeof Color)[keyof typeof Color];
