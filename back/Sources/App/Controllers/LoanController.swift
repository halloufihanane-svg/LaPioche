import Fluent
import Vapor

struct LoanController: RouteCollection {
    func boot(routes: any RoutesBuilder) throws {
        let loans = routes.grouped("loans")
        loans.post(use: create)
    }

    @Sendable
    func create(req: Request) async throws -> Response {
        let dto = try req.content.decode(CreateLoanDTO.self)

        guard let game = try await Game.find(dto.gameID, on: req.db) else {
            throw Abort(.notFound, reason: "Game not found")
        }
        guard let member = try await Member.find(dto.memberID, on: req.db) else {
            throw Abort(.notFound, reason: "Member not found")
        }
        // De la ligne 20 à 28 : résolution du bug 4
        let existingLoan = try await Loan.query(on: req.db) //D'abord on cherche s'il y'a un prêt actif
            .filter(\.$game.$id == game.requireID())
            .filter(\.$returnedAt == nil)
            .first()
        
        guard existingLoan == nil else { // Puis on s'assure qu'il n'y a pas de prêt en cours
            throw Abort(.conflict, reason: "Game is already on loan") // si c'est le cas, erreur HTTP est renvoyé .conflict (code 409)
        }

        let now = Date()
        let loan = Loan(
            gameID: try game.requireID(),
            memberID: try member.requireID(),
            borrowedAt: now,
            dueAt: try Loan.dueDate(from: now)
        )
        try await loan.save(on: req.db)
        return try await loan.toDTO().encodeResponse(status: .created, for: req)
    }
}
