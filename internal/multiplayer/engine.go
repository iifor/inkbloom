package multiplayer

import (
	_ "embed"
	"encoding/json"

	v8 "rogchap.com/v8go"
)

//go:generate sh -c "cd ../.. && go run ./cmd/build-rules"
//go:embed rules.js
var source string

// Each room owns an isolate. The room mutex serializes every call into it.
type engine struct {
	iso       *v8.Isolate
	ctx       *v8.Context
	functions map[string]*v8.Function
}

func newEngine() (*engine, error) {
	iso := v8.NewIsolate()
	ctx := v8.NewContext(iso)
	e := &engine{iso, ctx, map[string]*v8.Function{}}
	value, err := ctx.RunScript(source+"\nRules", "gameplay.js")
	if err != nil {
		e.close()
		return nil, err
	}
	obj, err := value.AsObject()
	if err != nil {
		e.close()
		return nil, err
	}
	for _, name := range []string{"init", "validate", "checkpoint", "join", "leave", "command", "tick", "beginPlan", "finishPlan"} {
		v, err := obj.Get(name)
		if err != nil {
			e.close()
			return nil, err
		}
		fn, err := v.AsFunction()
		if err != nil {
			e.close()
			return nil, err
		}
		e.functions[name] = fn
	}
	return e, nil
}
func (e *engine) close() { e.ctx.Close(); e.iso.Dispose() }
func (e *engine) call(name string, args ...any) (string, error) {
	values := make([]v8.Valuer, len(args))
	for i, arg := range args {
		switch n := arg.(type) {
		case int:
			arg = float64(n)
		case int64:
			arg = float64(n)
		}
		v, err := v8.NewValue(e.iso, arg)
		if err != nil {
			return "", err
		}
		defer v.Release()
		values[i] = v
	}
	result, err := e.functions[name].Call(v8.Undefined(e.iso), values...)
	if err != nil {
		return "", err
	}
	defer result.Release()
	return result.String(), nil
}

type delivery struct {
	IDs     []int
	Message json.RawMessage
}
