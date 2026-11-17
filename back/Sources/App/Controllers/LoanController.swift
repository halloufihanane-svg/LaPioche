import Fluent
import Vapor

struct LoanController: RouteCollection {
    func boot(routes: any RoutesBuilder) throws {
        let loans = routes.grouped("loans")
        loans.post(use: create)
        loans.post(":loanID", "return", use: returnLoan)
        loans.get("overdue", use: overdue) // Phase 3 (FEAT-05) : déclaration de la route GET /loans/overdue
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
    
    @Sendable
    // Enregistre le retour d'un jeu emprunté (POST /loans/:loanID/return)
    func returnLoan(req: Request) async throws -> LoanDTO {
        guard let loanID = req.parameters.get("loanID", as: UUID.self) else { // on récupère et on valide l'ID de l'emprunt depuis l'URL
            throw Abort(.badRequest, reason: "Invalid loan id")
        }
    
        guard let loan = try await Loan.find(loanID, on: req.db) else { // on cherche l'emprunt en base de données (404 s'il n'existe pas)
            throw Abort(.notFound, reason: "Loan not found")
        }
        
        guard loan.returnedAt == nil else { // on vérifie la règle métier : un emprunt déjà clôturé (returnedAt non nil) ne peut pas être rendu une seconde fois (409 Conflict)
            throw Abort(.conflict, reason: "This loan has already been returned")
        }
        loan.returnedAt = Date()
        
        try await loan.save(on: req.db)
        
        return loan.toDTO()
        
    }
     
    @Sendable
    func overdue(req: Request) async throws -> [LoanDTO] {
        return try await Loan.query(on: req.db)
            .filter(\.$returnedAt == nil)
            .filter(\.$dueAt < Date())
            .sort(\.$dueAt, .ascending)
            .all()
            .map { $0.toDTO() }
    }
}
