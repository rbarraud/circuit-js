'use strict'

var sId = 0;

// halt: () -> halt
//       V  -> halt.value
//       F  -> halt.thunk
//       P  -> halt.promise
//
// Halt propagation.
// - propagation is halted immediately.
// - optionally return:
//    value : state.value is immediately set to value.
//    thunk : thunk is immediately called with next() arg.
//    promise : propagation is tied to promise resolution.
//
// examples:
//  channel(A).map(v => halt(B)).map(v => v) // -> Channel B
//  channel(A).map(v => halt(next => setTimeout(() => next(B)))) -> Channel A...B
var halt = function(v, a) {
  if (!(this instanceof halt)) return new halt(v, !!arguments.length)
  if (typeof v === 'function') this.thunk = v
  else if (typeof v === 'object' && typeof v.then === 'function') this.promise = v
  else if (a || arguments.length === 1) this.$value =  v
}
var _halt = halt()

// fail: () -> fail.message: true
//       A  -> fail.message: A
//
// Fail propagation
// - propagation is halted immediately.
// - state is not updated.
// - optionally return failure message
//    NB: failure is not a state - it must be captured to be processed
//
// example:
//  channel(A).map(v => fail('boo!')).fail(f => console.log(f.message)) // boo!
var fail = function(m) {
  if (!(this instanceof fail)) return new fail(m)
  this.message = m || true
}
fail.prototype = Object.create(halt.prototype)


// internal signalling tunnel (used for cloning etc)
var _wrap = function(v) {
  var _this = this
  Object.keys(v).forEach(function(k){ _this[k] = v[k]})
}

// Channel - the object created and returned by Constructor
function Channel() {
  var sid = ++sId
  var _this = this
  var _feeds = [], _fails = [], _ext = []
  var _name = sid, _step, _steps = []
  var _state = {$value: undefined}, _pulse = Channel.id

  this.id = function(){return _this}
  this.id.isSignal = true
  this.isSignal = true

  var value, args = [].slice.call(arguments)
  args.forEach(function(a){
    if (typeof a === 'string') _name = a
    else if (a instanceof _wrap) _steps = a.steps
  })

  if (process.env.NODE_ENV==='development') {
    this.$state = _state
    _state.$id = sid
  }

  function propagate(v, c1, c2) {
    var args = arguments.length
    for (var i = _step; i < _steps.length && !(v instanceof halt); i++) {
      switch(args) {
        case 1: v = _steps[i](v); break
        case 2: v = _steps[i](v, c1); break
        case 3: v = _steps[i](v, c1, c2); break
        default: v = _steps[i].apply(null, [v].concat([].slice.call(arguments, 1)))
      }
    }

    if (v instanceof halt) {
      // handle thunks and promises in lieu of generators..
      if (v.thunk) {
        return v.thunk.call(null, nextStep(i))
      }
      else if (v.promise) {
        var next = nextStep(i)
        return v.promise.then(next, function(m) {next(new fail(m))})
      }
      else if (v instanceof fail) {
        for (var t = 0; t < _fails.length; t++) {
          _fails[t](v)
        }
      }
      else if (v.hasOwnProperty('$value')) _state.$value = v.$value

      return undefined
    }
    _state.$value = v
    for (var t = 0; t < _feeds.length; t++) {
      _feeds[t](v)
    }
    if (_pulse !== Channel.id) {
      _state.$value = _pulse
    }
    return v
  }

  // lift a function or channel into functor scope
  function lift(f) {
    _steps.push(f.signal || f)
    return _this
  }

  // allow values to be injected into the channel at arbitrary step points.
  // propagation continues from this point
  function nextStep(step) {
    step = step !== undefined? step : _steps.length + 1
    return function(){
      _step = step
      return propagate.apply(null, arguments)
    }
  }

  // Public API

  // channel).name : () -> name
  //
  // Return the channel name
  this.name = function() {
    return _name
  }

  // channel().signal : (A) -> A
  //
  // Signal a new value.
  //
  // Push a new signal value onto a channel. The signal will propagate.
  // eg : signal(123) -> Channel 123
  this.signal = nextStep(0)


  // Channel(A).next : (A) -> A
  //
  // Signal a new value at the next step point
  //
  // Push a new signal value into a channel at the next point in the propagation chain.
  // The signal will propagate onwards.
  // eg : channel.map(v=>v.forEach(i=>this.next(i)).signal([1,2,3]) -> Channel 1 : 2 : 3
  this.next = nextStep.bind(_this, undefined)

  // channel().pulse : (A) -> A
  //
  // reset channel value after propagation
  this.pulse = function(v) {
    _pulse = v
    return this
  }


  // channel(A).asSignal : (A) -> Channel A
  //                        (A -> B) -> Channel B
  //
  // return a value, a function or a channel in signal context
  this.asSignal = function(t) {
    if ((t || this).isSignal) return t || this
    var s = this.channel()
    return (typeof t === 'function'? s.map(t) : s)
  }


  // channel(A).value : () -> A
  //
  // Return the current signal value.
  this.value = function() {
    return _state.$value
  }


  // channel(A).clone : () -> Channel B
  //
  // Clone a channel into a new context
  this.clone = function() {
    return new Channel(new _wrap({steps: _steps}))
  }


  // channel().prime : (A) -> Channel A
  //
  // Set signal value directly, bypassing any propagation steps
  this.prime = function(v) {
    _state.$value = v
    return this
  }


  // channel().setState : (state(A)) -> Channel A
  //
  // Set signal state directly, bypassing any propagation steps
  this.setState = function(s) {
    _state = s
    if (process.env.NODE_ENV==='development') {
      this.$state = _state
      _state.$id = sid
    }
    return this
  }


  // channel(A).map : (A -> B) -> Channel B
  //
  // Map over the current signal value
  this.map = lift

  // channel(A).fail : (F) -> Channel A -> F(A)
  //
  // Register a fail handler.
  // The handler will be called after failed propagation.
  // The value passed to the handler will be the fail value.
  this.fail = function(f) {
    _fails.push(f.signal || f)
    return this
  }


  // channel(A).feed : (F) -> Channel A -> F(A)
  //
  // Register a feed handler.
  // The handler will be called after successful propagation.
  // The value passed to the handler will be the state value.
  this.feed = function(f) {
    _feeds.push(f.signal || f)
    return this
  }


  // channel(A).filter : (A -> boolean) -> channel A | HALT
  //
  // Filter the channel value.
  // - return truthy to continue propagation
  // - return falsey to halt propagation
  this.filter = function(f) {
    return lift(function (v) {
      return f.apply(null, arguments)? v: _halt
    })
  }

  // channel(A).fold : ((A, B) -> A, A) -> Channel A
  //
  // Continuously fold incoming channel values into an accumulated outgoing value.
  this.fold = function(f, accum) {
    return lift(function(v){
      var args = [accum].concat([].slice.call(arguments))
      accum = f.apply(null,args)
      return accum
    })
  }

  // channel(A).tap : (A) -> Channel A
  //
  // Tap the current signal value.
  // - tap ignores any value returned from the tap function.
  //
  // eg : tap(A => console.log(A)) -> Channel A
  this.tap = function(f) {
    return lift(function(v){
      f.apply(null, arguments)
      return v
    })
  }

  // channel(A).getState : () -> {value: A}
  //
  // Return the current channel state which minimally includes the current signal value.
  //
  // Note that state also includes channel context values which may be freely
  // accessed and amended within the binding context of propagation. Like most
  // J/S contexts, these values should be sparingly used in channel extensions.
  // They play no part in core signal propagation.
  //
  // example with context:
  //  channel.signal(true)
  //  channel.getState() // -> {$value: true}
  this.getState = function(raw) {
    return _state
  }

  // bind a function to signal context and propagate if function yields value
  this.bind = function(f, id) {
    id = id || _steps.length
    const ctx = _state[id] = _state[id] || {}
    ctx.id = id
    ctx.channel = _this
    ctx.next = nextStep()
    // bind f must return a channel or a channel functor
    var b = f(ctx);
    return lift(function(v1, v2, v3) {
      switch (arguments.length) {
        case 1: b(v1); break
        case 2: b(v1, v2); break
        case 3: b(v1, v2, v3); break
        default: b.apply(null, arguments)
      }
      return _halt
    })
  }

  // channel().extend : (Channel -> {A}) -> Channel
  //
  // extend a channel with a custom step (or steps)
  // Note: chainable steps must return channel
  var _ext = []
  this.extend = function(e) {
    _ext.push(e)
    if (typeof e === 'function') e = e(_this)
    Object.keys(e).forEach(function(k){
      if (typeof e[k] ==='object') _this.extend(e[k])
      else {
        _this[k] = e[k]
      }
    })
    return _this
  }

  // channel : (name, state) -> Channel
  //
  // Constructor function
  // - optional name
  // - optional initial state(v)
  this.channel = function(name, state) {
    var s = new Channel(name, state)
    for (var i = 0; i < _ext.length; i++) {
      s.extend(_ext[i])
    }
    return s
  }

}

// Channel.id: (A) -> A
// Identity function
Channel.id = function(v) {return v}

export {halt, fail}
export default Channel
